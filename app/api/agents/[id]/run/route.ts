import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import Ably from 'ably';
import { StrKey } from 'stellar-sdk';
import { getDemoAgentById, incrementDemoAgentStats } from '@/lib/demo-agents';
import { publish, TOPICS } from '@/lib/qstash';
import type { MarketplaceActivityEvent } from '@/types/events';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function isMissingAgentsTableError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return message.includes("could not find the table 'public.agents'")
    || message.includes('relation "public.agents" does not exist')
    || error.code === 'PGRST205';
}

function isMissingColumnError(
  error: { message?: string; code?: string } | null | undefined,
  table: string,
  column: string
): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return error.code === 'PGRST204' && message.includes(`'${column}'`) && message.includes(`'${table}'`);
}

const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';

function explorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

function isValidStellarPublicKey(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

async function getAgent(agentId: string) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return getDemoAgentById(agentId);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (error && isMissingAgentsTableError(error)) {
    return getDemoAgentById(agentId);
  }

  if (data) {
    return data;
  }

  // Keep local/demo IDs runnable even when connected DB has no matching row.
  const demo = getDemoAgentById(agentId);
  if (demo) {
    return demo;
  }

  return null;
}

async function runAgentModel(model: string, systemPrompt: string, userInput: string): Promise<string> {
  if (model === 'mock-echo') {
    return JSON.stringify(
      {
        model,
        summary: userInput.slice(0, 180),
        prompt: systemPrompt.slice(0, 120),
      },
      null,
      2
    );
  }

  if (model === 'openai-gpt4o-mini') {
    if (!process.env.OPENAI_API_KEY) {
      return '[Demo mode] OpenAI API key not configured. Your agent received the input and would normally respond here. Set OPENAI_API_KEY to enable live AI responses.';
    }
    try {
      const { runOpenAIAgent } = await import('@/lib/openai');
      return await runOpenAIAgent(systemPrompt, userInput);
    } catch (err) {
      console.warn('[run] OpenAI model error:', err instanceof Error ? err.message : String(err));
      return `[AI Error] The agent model returned an error: ${String(err)}. Payment was processed successfully.`;
    }
  }
  if (model === 'anthropic-claude-haiku') {
    if (!process.env.ANTHROPIC_API_KEY) {
      return '[Demo mode] Anthropic API key not configured. Your agent received the input and would normally respond here. Set ANTHROPIC_API_KEY to enable live AI responses.';
    }
    try {
      const { runAnthropicAgent } = await import('@/lib/anthropic');
      return await runAnthropicAgent(systemPrompt, userInput);
    } catch (err) {
      console.warn('[run] Anthropic model error:', err instanceof Error ? err.message : String(err));
      return `[AI Error] The agent model returned an error: ${String(err)}. Payment was processed successfully.`;
    }
  }
  return 'Unknown model';
}

async function verifyPayment(
  txHash: string,
  ownerWallet: string,
  priceXlm: number,
  agentId: string,
  callerWallet?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const { verifyPaymentTransaction } = await import('@/lib/stellar');
    const expectedMemoPrefix = `agent:${agentId}`.slice(0, 28);
    const result = await verifyPaymentTransaction(
      txHash,
      ownerWallet,
      priceXlm,
      expectedMemoPrefix,
      callerWallet
    );
    return result;
  } catch (err) {
    return {
      valid: false,
      error: `Payment verification exception: ${String(err)}`,
    };
  }
}

async function publishMarketplaceActivity(activity: MarketplaceActivityEvent): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key) return;

  try {
    const ably = new Ably.Rest({ key });
    await ably.channels.get('marketplace').publish(activity.eventType, activity);
  } catch (err) {
    console.warn('[run] Unable to publish realtime activity:', err);
  }

  try {
    await publish(TOPICS.MARKETPLACE_ACTIVITY, activity);
  } catch (err) {
    console.warn('[run] Unable to publish QStash marketplace event:', err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const startTime = Date.now();

  try {
    let agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    if (!agent.owner_wallet || typeof agent.owner_wallet !== 'string') {
      return NextResponse.json(
        { error: 'Agent owner wallet is not configured' },
        { status: 500 }
      );
    }

    if (!isValidStellarPublicKey(agent.owner_wallet)) {
      const demo = getDemoAgentById(agentId);
      if (demo && isValidStellarPublicKey(demo.owner_wallet)) {
        agent = demo;
      } else {
        return NextResponse.json(
          { error: 'Agent owner wallet is invalid' },
          { status: 500 }
        );
      }
    }

    const priceXlm = Number(agent.price_xlm || 0);
    if (Number.isNaN(priceXlm) || priceXlm < 0) {
      return NextResponse.json({ error: 'Agent pricing configuration is invalid' }, { status: 500 });
    }
    if (!agent.is_active) {
      return NextResponse.json({ error: 'Agent is not active' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as {
      input?: string;
      customization?: {
        prompt?: string;
        tags?: string[];
        api_endpoint?: string;
      };
    };
    const { input } = body;

    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing input field' }, { status: 400 });
    }

    // Check for existing payment
    const paymentTxHash = req.headers.get('X-Payment-Tx-Hash');
    const callerWallet = req.headers.get('X-Payment-Wallet') || '';

    if (priceXlm > 0 && !paymentTxHash) {
      // Issue 402 payment challenge
      const requestNonce = Math.random().toString(36).slice(2, 10);
      // Memo is capped at 28 bytes to match Stellar's limit (same cap applied in PaymentModal)
      const memo = `agent:${agentId}:req:${requestNonce}`.slice(0, 28);

      return NextResponse.json(
        {
          error: 'Payment required',
          payment_details: {
            amount_xlm: agent.price_xlm,
            address: agent.owner_wallet,
            network: 'stellar',
            memo,
          },
        },
        {
          status: 402,
          headers: {
            'X-Payment-Required': 'xlm',
            'X-Payment-Amount': String(agent.price_xlm),
            'X-Payment-Address': agent.owner_wallet,
            'X-Payment-Network': 'stellar',
            'X-Payment-Memo': memo,
          },
        }
      );
    }

    const requestId = uuidv4();
    const isMarketplaceAgent = ['public', 'forked'].includes(String(agent.visibility || ''));
    const effectivePrompt = isMarketplaceAgent && body.customization?.prompt
      ? body.customization.prompt
      : agent.system_prompt;

    if (paymentTxHash && priceXlm > 0) {
      // Verify paid request inline so API callers get immediate completion even
      // when background consumers are not running.
      const paymentVerification = await verifyPayment(
        paymentTxHash,
        agent.owner_wallet,
        priceXlm,
        agentId,
        callerWallet || undefined
      );
      if (!paymentVerification.valid) {
        console.warn('[run] Payment verification failed:', paymentVerification.error || 'unknown reason');
        return NextResponse.json(
          {
            error: 'Payment verification failed',
            details: paymentVerification.error || null,
          },
          { status: 402 }
        );
      }
    }

    // Free agent (price_xlm === 0) or synchronous fallback path
    const output = await runAgentModel(agent.model, effectivePrompt, input);
    const latencyMs = Date.now() - startTime;

    // Log to database
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const baseRequestPayload = {
          id: requestId,
          agent_id: agentId,
          caller_wallet: callerWallet || null,
          caller_ip: req.headers.get('x-forwarded-for') || null,
          input_payload: {
            input,
            customization: body.customization || null,
          },
          payment_tx_hash: paymentTxHash,
          tx_explorer_url: paymentTxHash ? explorerUrl(paymentTxHash) : null,
          payment_amount_xlm: paymentTxHash ? priceXlm : 0,
          status: 'success',
          latency_ms: latencyMs,
        };

        let insertRes = await supabase.from('agent_requests').insert({
          ...baseRequestPayload,
          output_payload: { output },
        });

        if (isMissingColumnError(insertRes.error, 'agent_requests', 'output_payload')) {
          insertRes = await supabase.from('agent_requests').insert({
            ...baseRequestPayload,
            output_response: { output },
          });
        }

        if (insertRes.error && !isMissingAgentsTableError(insertRes.error)) {
          console.warn('[run] DB insert error:', insertRes.error);
        }

        if (!insertRes.error && paymentTxHash) {
          const txExplorerUrl = explorerUrl(paymentTxHash);
          const invoiceRes = await supabase.from('invoices').upsert(
            {
              request_id: requestId,
              agent_id: agentId,
              owner_wallet: agent.owner_wallet,
              caller_wallet: callerWallet || null,
              amount_xlm: priceXlm,
              tx_hash: paymentTxHash,
              tx_explorer_url: txExplorerUrl,
            },
            { onConflict: 'request_id' }
          );
          if (invoiceRes.error) {
            console.warn('[run] invoice upsert error:', invoiceRes.error);
          }
        }

        const totalRequests = Number(agent.total_requests || 0);
        const totalEarned = Number(agent.total_earned_xlm || 0);

        const updateRes = await supabase
          .from('agents')
          .update({
            total_requests: totalRequests + 1,
            total_earned_xlm: paymentTxHash
              ? totalEarned + priceXlm
              : totalEarned,
            updated_at: new Date().toISOString(),
          })
          .eq('id', agentId);

        if (updateRes.error) {
          console.warn('[run] agent stats update error:', updateRes.error);
        }
      } catch (dbErr) {
        console.warn('[run] DB persistence failed, continuing response:', dbErr);
        incrementDemoAgentStats(agentId, {
          paid: Boolean(paymentTxHash),
          amountXlm: Number(agent.price_xlm || 0),
        });
      }
    } else {
      incrementDemoAgentStats(agentId, {
        paid: Boolean(paymentTxHash),
        amountXlm: Number(agent.price_xlm || 0),
      });
    }

    const activity: MarketplaceActivityEvent = {
      eventType: 'agent_run',
      agentId,
      agentName: agent.name,
      callerWallet: callerWallet || undefined,
      ownerWallet: agent.owner_wallet,
      priceXlm: paymentTxHash ? priceXlm : 0,
      txHash: paymentTxHash || undefined,
      txExplorerUrl: paymentTxHash ? explorerUrl(paymentTxHash) : undefined,
      timestamp: new Date().toISOString(),
    };

    await publishMarketplaceActivity(activity);

    return NextResponse.json({
      output,
      request_id: requestId,
      latency_ms: latencyMs,
      tx_hash: paymentTxHash || null,
      tx_explorer_url: paymentTxHash ? explorerUrl(paymentTxHash) : null,
      billed_xlm: paymentTxHash ? priceXlm : 0,
      runtime: {
        agent_id: agentId,
        owner_wallet: agent.owner_wallet,
        api_endpoint: agent.api_endpoint || null,
        api_key: agent.api_key || null,
        model: agent.model,
        visibility: agent.visibility,
      },
    });
  } catch (err) {
    console.error('Agent run error:', err);
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'production' ? undefined : details,
      },
      { status: 500 }
    );
  }
}
