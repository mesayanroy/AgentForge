#!/usr/bin/env node
/**
 * cli/index.ts
 *
 * AgentForge CLI — run agents and manage the 0x402 payment protocol from
 * the terminal.
 *
 * Usage:
 *   agentforge agents list
 *   agentforge agents run <agentId> --input "your prompt"
 *   agentforge agents run <agentId> --input "..." --secret <STELLAR_SECRET>
 *   agentforge tx status <txHash>
 *   agentforge tx inspect <txHash>
 *
 * The CLI integrates with the 0x402 payment protocol: when an agent requires
 * payment, the CLI builds a Stellar payment transaction using the provided
 * secret key, signs it, submits it to Horizon and retries the agent call with
 * the transaction hash in the X-Payment-Tx-Hash header.
 *
 * In a browser context you would use Freighter instead of a raw secret key.
 * For automated / server-side usage this CLI uses stellar-sdk directly.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import path from 'node:path';
import {
  Keypair,
  Networks,
  Asset,
  Memo,
  TransactionBuilder,
  Operation,
  Horizon,
} from 'stellar-sdk';

function loadEnvFile(filePath = path.join(process.cwd(), '.env.local')): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && (process.env[key] === undefined || process.env[key] === '')) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvFile();

// ─── Banner ───────────────────────────────────────────────────────────────────

const BANNER = `
${chalk.cyan('╔═══════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('  █████╗  ██████╗ ███████╗███╗   ██╗████████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('        ███████╗ ██████╗ ██████╗  ██████╗ ███████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('        ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('        █████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('        ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('        ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('        ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.cyan('              AgentForge CLI')}                    ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('  init · agents · a2a · dash · tx')}               ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════╝')}
  ${chalk.gray('CLI v0.1.0 · 0x402 Payment Protocol · Stellar Testnet')}
`;

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_API_BASE = process.env.AGENTFORGE_API_URL || 'http://localhost:3000';
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const LOCAL_AGENT_STORE_PATH = path.join(process.cwd(), '.agent-store.json');
const STELLAR_NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet') as
  | 'testnet'
  | 'mainnet';
const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'mainnet'
    ? Networks.PUBLIC
    : Networks.TESTNET;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stellarExplorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/${STELLAR_NETWORK}/tx/${txHash}`;
}

function truncate(s: string, n = 8): string {
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

function writeTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content);
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

interface AgentRecord {
  id: string;
  name: string;
  description: string;
  model: string;
  price_xlm: number;
  total_requests: number;
  total_earned_xlm: number;
  is_active: boolean;
  owner_wallet: string;
}

interface RunResponse {
  output?: string;
  request_id?: string;
  latency_ms?: number;
  error?: string;
  payment_details?: {
    amount_xlm: number;
    address: string;
    network: string;
    memo: string;
  };
}

interface LocalAgentStore {
  agents?: Array<Partial<AgentRecord> & { id: string; name?: string }>;
}

/**
 * Build, sign and submit a Stellar XLM payment.
 * Returns the transaction hash.
 */
async function payXLM(
  secretKey: string,
  destination: string,
  amountXlm: number,
  memo: string
): Promise<string> {
  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server(HORIZON_URL);

  const account = await server.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: amountXlm.toFixed(7),
      })
    )
    .addMemo(Memo.text(memo.slice(0, 28)))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function isLocalApiBase(apiBase: string): boolean {
  try {
    const url = new URL(apiBase);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function fallbackDemoAgent(): AgentRecord {
  return {
    id: '1',
    owner_wallet: 'GBZTWIV3ISK4KRBHP2BUVUB4PVZ6CK3AWBYLQLAI2JKVX45U63CO4PLW',
    name: 'DeFi Analyst',
    description: 'Analyzes DeFi protocols, yields, and on-chain metrics in real time.',
    model: 'openai-gpt4o-mini',
    price_xlm: 0.05,
    total_requests: 0,
    total_earned_xlm: 0,
    is_active: true,
  };
}

function readLocalAgentsFallback(): AgentRecord[] {
  try {
    if (!fs.existsSync(LOCAL_AGENT_STORE_PATH)) {
      return [fallbackDemoAgent()];
    }

    const raw = fs.readFileSync(LOCAL_AGENT_STORE_PATH, 'utf8').trim();
    if (!raw) return [fallbackDemoAgent()];

    const parsed = JSON.parse(raw) as LocalAgentStore;
    const rows = Array.isArray(parsed.agents) ? parsed.agents : [];

    const agents = rows
      .filter((a) => a && typeof a.id === 'string' && a.id.length > 0)
      .map((a) => ({
        id: a.id,
        owner_wallet:
          typeof a.owner_wallet === 'string' && a.owner_wallet.length > 0
            ? a.owner_wallet
            : 'unknown',
        name:
          typeof a.name === 'string' && a.name.length > 0
            ? a.name
            : `Agent ${a.id}`,
        description: typeof a.description === 'string' ? a.description : '',
        model: typeof a.model === 'string' ? a.model : 'unknown',
        price_xlm: typeof a.price_xlm === 'number' ? a.price_xlm : 0,
        total_requests:
          typeof a.total_requests === 'number' ? a.total_requests : 0,
        total_earned_xlm:
          typeof a.total_earned_xlm === 'number' ? a.total_earned_xlm : 0,
        is_active: typeof a.is_active === 'boolean' ? a.is_active : true,
      }))
      .filter((a) => a.is_active);

    return agents.length > 0 ? agents : [fallbackDemoAgent()];
  } catch {
    return [fallbackDemoAgent()];
  }
}

async function fetchAgents(apiBase: string): Promise<AgentRecord[]> {
  try {
    const res = await fetch(`${apiBase}/api/agents/list`, { method: 'GET' });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = (await res.json()) as { agents?: AgentRecord[] };
    return data.agents ?? [];
  } catch (err) {
    if (isLocalApiBase(apiBase)) {
      return readLocalAgentsFallback();
    }
    throw err;
  }
}

async function submitSignedXdr(signedXdr: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

async function runAgent(
  apiBase: string,
  agentId: string,
  input: string,
  walletAddress?: string,
  txHash?: string
): Promise<RunResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (walletAddress) headers['X-Payment-Wallet'] = walletAddress;
  if (txHash) headers['X-Payment-Tx-Hash'] = txHash;

  const res = await fetch(`${apiBase}/api/agents/${agentId}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
  });

  return (await res.json()) as RunResponse;
}

// ─── CLI program ──────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('agentforge')
  .description(
    chalk.cyan('AgentForge CLI') +
      ' — Run AI agents with 0x402 Stellar payments from your terminal'
  )
  .version('0.1.0')
  .option('--api <url>', 'AgentForge API base URL', DEFAULT_API_BASE);

// ── agents list ──────────────────────────────────────────────────────────────

const agentsCmd = program.command('agents').description('Manage and run agents');

agentsCmd
  .command('list')
  .description('List all available agents')
  .action(async () => {
    const apiBase = program.opts().api as string;
    const spinner = ora('Fetching agents…').start();
    try {
      const agents = await fetchAgents(apiBase);
      spinner.succeed(`Found ${agents.length} agent(s)`);
      console.log('');

      if (agents.length === 0) {
        console.log(chalk.gray('  No agents found.'));
        return;
      }

      for (const a of agents) {
        const priceTag =
          a.price_xlm > 0
            ? chalk.yellow(`${a.price_xlm} XLM`)
            : chalk.green('FREE');
        const status = a.is_active ? chalk.green('●') : chalk.red('●');
        console.log(
          `  ${status} ${chalk.bold(a.name)} ${chalk.gray(`(${a.id})`)}  ${priceTag}`
        );
        console.log(`     ${chalk.gray(a.description ?? 'No description')}`);
        console.log(
          `     Model: ${chalk.cyan(a.model)}  Requests: ${a.total_requests}  Earned: ${a.total_earned_xlm} XLM`
        );
        console.log('');
      }
    } catch (err) {
      spinner.fail(`Failed to fetch agents: ${String(err)}`);
      process.exit(1);
    }
  });

// ── agents run ───────────────────────────────────────────────────────────────

agentsCmd
  .command('run <agentId>')
  .description('Run an agent with the 0x402 payment protocol')
  .requiredOption('-i, --input <text>', 'Input prompt for the agent')
  .option(
    '-s, --secret <key>',
    'Stellar secret key for payment signing (or set STELLAR_AGENT_SECRET env var)'
  )
  .option(
    '--signed-xdr <xdr>',
    'Signed payment XDR (e.g. signed via Freighter) for submitting the 402 payment'
  )
  .action(
    async (
      agentId: string,
      opts: { input: string; secret?: string; signedXdr?: string }
    ) => {
      const apiBase = program.opts().api as string;
      const secretKey = opts.secret || process.env.STELLAR_AGENT_SECRET;

      console.log('');
      console.log(chalk.bold(`🤖 Running agent: ${chalk.cyan(agentId)}`));
      console.log(`   Input: ${chalk.gray(opts.input)}`);
      console.log('');

      // First request — may return 402
      let spinner = ora('Sending request…').start();
      let response: RunResponse;

      try {
        response = await runAgent(apiBase, agentId, opts.input);
      } catch (err) {
        spinner.fail(`Request failed: ${String(err)}`);
        process.exit(1);
      }

      // ── Handle 402 Payment Required ────────────────────────────────────
      if (response.payment_details) {
        const pd = response.payment_details;
        spinner.warn(
          chalk.yellow(`Payment required: ${pd.amount_xlm} XLM → ${truncate(pd.address)}`)
        );

        if (!secretKey && !opts.signedXdr) {
          console.log('');
          console.log(
            chalk.red('  ✗ No Stellar secret key provided.') +
              '\n    Pass --secret <KEY>, set STELLAR_AGENT_SECRET, or pass --signed-xdr from Freighter.'
          );
          console.log('');
          console.log(chalk.gray('  Payment details:'));
          console.log(`    Amount : ${pd.amount_xlm} XLM`);
          console.log(`    To     : ${pd.address}`);
          console.log(`    Memo   : ${pd.memo}`);
          process.exit(1);
        }

        let walletAddress = '';
        if (secretKey) {
          const keypair = Keypair.fromSecret(secretKey);
          walletAddress = keypair.publicKey();
        }

        spinner = ora(
          opts.signedXdr
            ? 'Submitting Freighter-signed payment XDR…'
            : `Building & signing Stellar payment from ${truncate(walletAddress)}…`
        ).start();

        let txHash: string;
        try {
          if (opts.signedXdr) {
            txHash = await submitSignedXdr(opts.signedXdr);
          } else {
            txHash = await payXLM(secretKey as string, pd.address, pd.amount_xlm, pd.memo);
          }
          spinner.succeed(
            chalk.green(`Payment submitted!  tx: ${truncate(txHash, 12)}`)
          );
          console.log(`   Explorer: ${chalk.underline(stellarExplorerUrl(txHash))}`);
        } catch (err) {
          spinner.fail(`Payment failed: ${String(err)}`);
          process.exit(1);
        }

        if (!walletAddress) {
          spinner = ora('Fetching tx source account for X-Payment-Wallet header…').start();
          try {
            const server = new Horizon.Server(HORIZON_URL);
            const tx = await server.transactions().transaction(txHash).call();
            walletAddress = tx.source_account;
            spinner.succeed(`Source wallet resolved: ${truncate(walletAddress)}`);
          } catch (err) {
            spinner.fail(`Cannot infer wallet from tx ${truncate(txHash)}: ${String(err)}`);
            process.exit(1);
          }
        }

        // Retry with payment proof
        spinner = ora('Retrying agent request with payment proof…').start();
        try {
          response = await runAgent(apiBase, agentId, opts.input, walletAddress, txHash);
        } catch (err) {
          spinner.fail(`Retry failed: ${String(err)}`);
          process.exit(1);
        }
      }

      if (response.error) {
        spinner.fail(chalk.red(`Agent error: ${response.error}`));
        process.exit(1);
      }

      spinner.succeed(
        `Done  ${chalk.gray(`(${response.latency_ms ?? '?'}ms | request_id: ${response.request_id ?? 'n/a'})`)}`
      );
      console.log('');
      console.log(chalk.bold('Output:'));
      console.log('');
      console.log(response.output ?? '(empty)');
      console.log('');
    }
  );

// ── tx status ────────────────────────────────────────────────────────────────

const txCmd = program.command('tx').description('Inspect Stellar transactions');

txCmd
  .command('status <txHash>')
  .description('Check the status of a Stellar transaction')
  .action(async (txHash: string) => {
    const spinner = ora(`Checking tx ${truncate(txHash, 12)}…`).start();
    try {
      const server = new Horizon.Server(HORIZON_URL);
      const tx = await server.transactions().transaction(txHash).call();
      spinner.succeed(tx.successful ? chalk.green('Transaction confirmed') : chalk.red('Transaction failed'));
      console.log('');
      console.log(`  Hash    : ${chalk.cyan(tx.hash)}`);
      console.log(`  Ledger  : ${tx.ledger_attr}`);
      console.log(`  Fee     : ${tx.fee_charged} stroops`);
      console.log(`  Memo    : ${tx.memo ?? '(none)'}`);
      console.log(`  Explorer: ${chalk.underline(stellarExplorerUrl(txHash))}`);
      console.log('');
    } catch (err) {
      spinner.fail(`Cannot retrieve tx: ${String(err)}`);
    }
  });

txCmd
  .command('inspect <txHash>')
  .description('Show full transaction details from Stellar explorer')
  .action(async (txHash: string) => {
    const url = stellarExplorerUrl(txHash);
    console.log('');
    console.log(chalk.bold(`Transaction: ${txHash}`));
    console.log(`Explorer URL: ${chalk.underline(url)}`);
    console.log('');
    const spinner = ora('Fetching transaction details from Horizon…').start();
    try {
      const server = new Horizon.Server(HORIZON_URL);
      const tx = await server.transactions().transaction(txHash).call();
      spinner.succeed('Details loaded');
      console.log('');
      console.log(JSON.stringify(tx, null, 2));
    } catch (err) {
      spinner.fail(`Error: ${String(err)}`);
    }
  });

// ─── A2A agent-to-agent routing ───────────────────────────────────────────────

const a2aCmd = program
  .command('a2a')
  .description('Agent-to-Agent request routing via 0x402');

a2aCmd
  .command('call <fromAgentId> <toAgentId>')
  .description('Route a request from one agent to another (A2A payment flow)')
  .requiredOption('-i, --input <text>', 'Input for the target agent')
  .option('-s, --secret <key>', 'Stellar secret key', process.env.STELLAR_AGENT_SECRET)
  .option('-c, --correlation <id>', 'Custom correlation ID')
  .action(
    async (
      fromAgentId: string,
      toAgentId: string,
      opts: { input: string; secret?: string; correlation?: string }
    ) => {
      const apiBase = program.opts().api as string;
      const correlationId = opts.correlation ?? `a2a-${Date.now()}`;

      console.log('');
      console.log(
        chalk.bold(`🔀 A2A: ${chalk.cyan(fromAgentId)} → ${chalk.cyan(toAgentId)}`)
      );
      console.log(`   Input: ${chalk.gray(opts.input)}`);
      console.log(`   Correlation: ${chalk.gray(correlationId)}`);
      console.log('');

      const secretKey = opts.secret || process.env.STELLAR_AGENT_SECRET;
      if (!secretKey) {
        console.log(chalk.red('  ✗ No Stellar secret key provided.'));
        process.exit(1);
      }
      const walletAddress = Keypair.fromSecret(secretKey).publicKey();

      // Publish A2A request via QStash
      const qstashToken = process.env.QSTASH_TOKEN;
      const qstashUrl = process.env.QSTASH_URL || 'https://qstash.upstash.io';
      if (!qstashToken) {
        console.log(chalk.yellow('  ⚠ QSTASH_TOKEN not set – calling target agent directly.'));
        const response = await runAgent(apiBase, toAgentId, opts.input, walletAddress);
        if (response.output) {
          console.log(chalk.bold('Output:'));
          console.log(response.output);
        }
        return;
      }

      const spinner = ora('Publishing A2A request to QStash…').start();
      const payload = {
        correlationId,
        fromAgentId,
        toAgentId,
        input: opts.input,
        callerWallet: walletAddress,
        createdAt: new Date().toISOString(),
      };

      try {
        const res = await fetch(`${qstashUrl}/v2/publish/${apiBase}/api/consumers/agentforge-a2a-request`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`QStash error: ${res.status}`);
        spinner.succeed('A2A request queued via QStash');
        console.log(chalk.gray(`  Correlation ID: ${correlationId}`));
        console.log(chalk.gray('  Response will be delivered asynchronously.'));
      } catch (err) {
        spinner.fail(`Failed to queue A2A request: ${String(err)}`);
        if (isLocalApiBase(apiBase)) {
          console.log(chalk.yellow('  ⚠ Falling back to direct target-agent call in local mode.'));
          const response = await runAgent(apiBase, toAgentId, opts.input, walletAddress);
          if (response.error) {
            console.log(chalk.red(`  ✗ Target agent error: ${response.error}`));
            process.exit(1);
          }
          if (response.output) {
            console.log(chalk.bold('Output:'));
            console.log(response.output);
          }
          return;
        }
        process.exit(1);
      }
    }
  );

program
  .command('init [projectName]')
  .description('Initialize a new AgentForge agent project')
  .action(async (projectName: string = 'my-agent') => {
    console.log(chalk.bold.cyan(`\n🚀 Initializing AgentForge project: ${projectName}\n`));
    const spinner = ora('Creating project structure…').start();

    const dirs = [
      projectName,
      `${projectName}/agents`,
      `${projectName}/agents/templates`,
      `${projectName}/tasks`,
      `${projectName}/workflows`,
      `${projectName}/config`,
      `${projectName}/docs`,
      `${projectName}/src`,
      `${projectName}/.agentforge`,
    ];

    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }

    writeTextFile(
      `${projectName}/.env.example`,
      `# AgentForge Environment
AGENTFORGE_API_URL=http://localhost:3000
STELLAR_AGENT_SECRET=
QSTASH_TOKEN=
ABLY_API_KEY=
NEXT_PUBLIC_ABLY_KEY=
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
`
    );

    writeTextFile(`${projectName}/.env`, '# Copy values from .env.example and fill in your secrets\n');

    writeJsonFile(`${projectName}/config/agents.json`, {
      agents: [
        {
          id: 'agent-1',
          name: 'My First Agent',
          model: 'openai-gpt4o-mini',
          price_xlm: 0.05,
          description: 'Starter AgentForge agent scaffold',
        },
      ],
    });

    writeJsonFile(`${projectName}/config/dashboard.json`, {
      title: 'AgentForge Polymarket Dashboard',
      pairs: ['XLM/USDC', 'BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'AF$/USDC'],
      refreshIntervalMs: 3000,
    });

    writeJsonFile(`${projectName}/agents/templates/researcher.json`, {
      name: 'Researcher',
      model: 'openai-gpt4o-mini',
      prompt: 'Analyze markets, summarize opportunities, and return concise action items.',
      tasks: ['scan', 'summarize', 'rank'],
    });

    writeJsonFile(`${projectName}/agents/templates/trader.json`, {
      name: 'Trader',
      model: 'openai-gpt4o-mini',
      prompt: 'Evaluate execution signals and prepare trade-ready instructions.',
      tasks: ['evaluate', 'score', 'execute'],
    });

    writeJsonFile(`${projectName}/tasks/queued.json`, []);
    writeJsonFile(`${projectName}/tasks/completed.json`, []);

    writeJsonFile(`${projectName}/workflows/default.json`, {
      name: 'Default Workflow',
      tasks: [],
      agents: [],
      notes: '',
      createdAt: new Date().toISOString(),
    });

    writeTextFile(
      `${projectName}/docs/CLI_GUIDE.md`,
      `# AgentForge CLI Guide\n\nUse the terminal to list agents, run paid requests, inspect Stellar transactions, and watch the live dashboard.\n`
    );

    writeJsonFile(`${projectName}/.agentforge/dashboard.json`, {
      mode: 'polymarket',
      theme: 'terminal-neon',
      includeActivityFeed: true,
    });

    writeTextFile(
      `${projectName}/README.md`,
      `# ${projectName}\n\nAgentForge project scaffolded with \`agentforge init\`.\n\n## Quick Start\n\n\`\`\`bash\ncp .env.example .env\nagentforge agents list\nagentforge agents run <agentId> --input "your prompt"\nagentforge dash\n\`\`\`\n`
    );

    spinner.succeed(chalk.green('Project structure created!'));
    console.log('');
    console.log(chalk.bold('Created:'));
    dirs.forEach((d) => console.log(chalk.gray(`  📁 ${d}`)));
    console.log(chalk.gray(`  📄 ${projectName}/.env.example`));
    console.log(chalk.gray(`  📄 ${projectName}/.env`));
    console.log(chalk.gray(`  📄 ${projectName}/config/agents.json`));
    console.log(chalk.gray(`  📄 ${projectName}/config/dashboard.json`));
    console.log(chalk.gray(`  📄 ${projectName}/agents/templates/researcher.json`));
    console.log(chalk.gray(`  📄 ${projectName}/agents/templates/trader.json`));
    console.log(chalk.gray(`  📄 ${projectName}/tasks/queued.json`));
    console.log(chalk.gray(`  📄 ${projectName}/tasks/completed.json`));
    console.log(chalk.gray(`  📄 ${projectName}/workflows/default.json`));
    console.log(chalk.gray(`  📄 ${projectName}/docs/CLI_GUIDE.md`));
    console.log(chalk.gray(`  📄 ${projectName}/.agentforge/dashboard.json`));
    console.log(chalk.gray(`  📄 ${projectName}/README.md`));
    console.log('');
    console.log(chalk.bold('Next steps:'));
    console.log(chalk.gray(`  1. cd ${projectName}`));
    console.log(chalk.gray('  2. cp .env.example .env and fill in your API keys'));
    console.log(chalk.gray('  3. agentforge agents list'));
    console.log(chalk.gray('  4. agentforge dash'));
    console.log(chalk.gray('  5. agentforge agents run <agentId> --input "your prompt" --secret <STELLAR_SECRET>'));
    console.log('');
  });

program
  .command('runtime')
  .description('Local runtime utilities (development)')
  .command('run <agentId>')
  .description('Run an agent locally using the runtime runner')
  .requiredOption('-i, --input <text>', 'Input prompt for the agent')
  .option('--docker', 'Run the agent inside the Docker runner image')
  .action(async (agentId: string, opts: { input: string; docker?: boolean }) => {
    console.log('Starting local runtime run...');
    try {
      if (agentId === 'demo-echo') {
        const output = JSON.stringify(
          {
            model: 'mock-echo',
            summary: opts.input.slice(0, 180),
            prompt: 'Echo back the input in a concise structured form.',
          },
          null,
          2
        );
        console.log('--- RESULT ---');
        console.log('requestId:', `cli-${Date.now()}`);
        console.log('latencyMs:', 0);
        console.log('output:\n', output);
        return;
      }

      if (opts.docker) {
        const child = await import('child_process');
        const spawn = child.spawnSync('npx', ['-y', 'ts-node', '--project', 'tsconfig.json', 'runtime/runner/docker-runner.ts', agentId, opts.input], { stdio: 'inherit' });
        if (spawn.status !== 0) process.exit(spawn.status ?? 1);
        return;
      }

      // Prefer direct in-process execution by calling consumers.executeAgentLocally.
      // If module resolution fails under the current ts-node mode, fall back below.
      try {
        const mod = await import('../consumers/agent-executor');
        if (typeof mod.executeAgentLocally === 'function') {
          const res = await mod.executeAgentLocally(agentId, opts.input, { requestId: `cli-${Date.now()}` });
          console.log('--- RESULT ---');
          console.log('requestId:', res.requestId);
          console.log('latencyMs:', res.latencyMs);
          console.log('output:\n', res.output);
          return;
        }
      } catch {
        // continue to fallback runner path
      }

      // Lightweight deterministic fallback for local demo agents.
      try {
        const demo = await import('../lib/demo-agents');
        const found = typeof demo.getDemoAgentById === 'function' ? demo.getDemoAgentById(agentId) : null;
        if (found?.model === 'mock-echo') {
          const output = JSON.stringify(
            {
              model: found.model,
              summary: opts.input.slice(0, 180),
              prompt: String(found.system_prompt ?? '').slice(0, 120),
            },
            null,
            2
          );
          console.log('--- RESULT ---');
          console.log('requestId:', `cli-${Date.now()}`);
          console.log('latencyMs:', 0);
          console.log('output:\n', output);
          return;
        }
      } catch {
        // continue to fallback runner path
      }

      // Fallback to runner script
      const child = await import('child_process');
      const spawn = child.spawnSync('npx', ['-y', 'ts-node', '--project', 'tsconfig.json', 'runtime/runner/index.ts', agentId, opts.input], { stdio: 'inherit' });
      if (spawn.status !== 0) process.exit(spawn.status ?? 1);
    } catch (err) {
      console.error('Local runtime failed:', err);
      process.exit(1);
    }
  });

program
  .command('workflow')
  .description('Run workflows locally (development)')
  .command('run <file>')
  .description('Run a workflow JSON file locally')
  .action(async (file: string) => {
    try {
      const child = await import('child_process');
      const fs = await import('fs');
      const runnerPath = path.join(process.cwd(), 'dist', 'orchestrator-runner.js');
      let spawn;
      if (fs.existsSync(runnerPath)) {
        spawn = child.spawnSync('node', [runnerPath, file], { stdio: 'inherit' });
      } else {
        const script = `require('./orchestrator/orchestrator').runWorkflowFile(process.argv[1]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Orchestrator error:', e); process.exit(1)});`;
        spawn = child.spawnSync('npx', ['ts-node', '--transpile-only', '--project', 'tsconfig.json', '-e', script, file], { stdio: 'inherit' });
      }
      if (spawn.error) throw spawn.error;
      if (spawn.status !== 0) process.exit(spawn.status ?? 1);
    } catch (err) {
      console.error('Workflow run failed:', err);
      process.exit(1);
    }
  });

program
  .command('dash')
  .description('Live terminal dashboard — markets, agents, PnL, recent activity')
  .option('--interval <ms>', 'Refresh interval in ms', '3000')
  .action(async (opts: { interval: string }) => {
    const apiBase = program.opts().api as string;
    const interval = Math.max(1000, parseInt(opts.interval, 10) || 3000);

    function clearScreen() {
      process.stdout.write('\x1B[2J\x1B[0f');
    }

    function colorPnl(n: number): string {
      if (n > 0) return chalk.green(`+${n.toFixed(4)}`);
      if (n < 0) return chalk.red(`${n.toFixed(4)}`);
      return chalk.white('0.0000');
    }

    const PAIRS = ['XLM/USDC', 'BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'AF$/USDC'];
    const COLORS = [chalk.cyan, chalk.yellow, chalk.green, chalk.blue, chalk.white];

    function fakePrice(base: number, variance: number) {
      return (base + (Math.random() - 0.5) * variance).toFixed(4);
    }

    async function render() {
      let agents: AgentRecord[] = [];
      try {
        agents = await fetchAgents(apiBase);
      } catch {
        agents = [];
      }

      clearScreen();
      console.log(BANNER);
      console.log(chalk.bold.white('  ┌─────────────────────────────────────────────────────────────────────┐'));
      console.log(chalk.bold.white('  │') + chalk.bold.cyan('  📊 POLYMARKET DASHBOARD  ') + chalk.gray('(testnet simulation · Stellar DEX)') + chalk.bold.white('              │'));
      console.log(chalk.bold.white('  ├──────────────┬──────────────┬───────────┬───────────┬───────────────┤'));
      console.log(chalk.bold.white('  │') + chalk.bold('  Pair         ') + chalk.bold.white('│') + chalk.bold('  Price       ') + chalk.bold.white('│') + chalk.bold(' 24h Change') + chalk.bold.white('│') + chalk.bold('   Volume  ') + chalk.bold.white('│') + chalk.bold('  Prediction   ') + chalk.bold.white('│'));
      console.log(chalk.bold.white('  ├──────────────┼──────────────┼───────────┼───────────┼───────────────┤'));

      const bases = [0.12, 43200, 2500, 170, 0.05];
      for (let i = 0; i < PAIRS.length; i++) {
        const price = parseFloat(fakePrice(bases[i], bases[i] * 0.03));
        const change = (Math.random() - 0.45) * 8;
        const vol = (Math.random() * 500000 + 50000).toFixed(0);
        const pred = Math.random() > 0.5 ? chalk.green('▲ BULLISH') : chalk.red('▼ BEARISH');
        const changeStr = change >= 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`);
        const col = COLORS[i];
        console.log(
          chalk.bold.white('  │') +
          col(`  ${PAIRS[i].padEnd(13)}`) +
          chalk.bold.white('│') +
          chalk.white(`  ${String(price).padEnd(12)}`) +
          chalk.bold.white('│') +
          ` ${changeStr.padEnd(18)}` +
          chalk.bold.white('│') +
          chalk.white(` $${vol.padStart(9)} `) +
          chalk.bold.white('│') +
          `  ${pred.padEnd(21)}` +
          chalk.bold.white('│')
        );
      }
      console.log(chalk.bold.white('  └──────────────┴──────────────┴───────────┴───────────┴───────────────┘'));
      console.log('');

      console.log(chalk.bold.white('  ┌─────────────────────────────────────────────────────────────────────┐'));
      console.log(chalk.bold.white('  │') + chalk.bold.yellow('  🤖 ACTIVE AGENTS') + chalk.bold.white('                                                    │'));
      console.log(chalk.bold.white('  ├────────────────────────────┬────────────────┬──────────┬────────────┤'));
      console.log(chalk.bold.white('  │') + chalk.bold('  Agent                     ') + chalk.bold.white('│') + chalk.bold('  Model         ') + chalk.bold.white('│') + chalk.bold(' Requests ') + chalk.bold.white('│') + chalk.bold(' Earned XLM ') + chalk.bold.white('│'));
      console.log(chalk.bold.white('  ├────────────────────────────┼────────────────┼──────────┼────────────┤'));
      for (const a of agents.slice(0, 5)) {
        const status = a.is_active ? chalk.green('●') : chalk.red('●');
        console.log(
          chalk.bold.white('  │') +
          ` ${status} ${chalk.cyan(a.name.slice(0, 24).padEnd(26))}` +
          chalk.bold.white('│') +
          chalk.gray(` ${a.model.slice(0, 14).padEnd(15)} `) +
          chalk.bold.white('│') +
          chalk.white(`  ${String(a.total_requests).padStart(6)}  `) +
          chalk.bold.white('│') +
          chalk.yellow(` ${a.total_earned_xlm.toFixed(2).padStart(9)} XLM`) +
          chalk.bold.white('│')
        );
      }
      if (agents.length === 0) {
        console.log(chalk.bold.white('  │') + chalk.gray('  No agents found. Run agentforge agents list') + chalk.bold.white('                        │'));
      }
      console.log(chalk.bold.white('  └────────────────────────────┴────────────────┴──────────┴────────────┘'));
      console.log('');

      const activities = [
        { type: chalk.cyan('AGENT_RUN'), agent: 'MEV Bot', amount: colorPnl(0.05), wallet: 'GB3X...9K' },
        { type: chalk.green('PAYMENT'), agent: 'Trading Bot', amount: colorPnl(0.1), wallet: 'GC7Y...2M' },
        { type: chalk.yellow('STAKING'), agent: 'Liquidity Tracker', amount: colorPnl(-0.02), wallet: 'GA2B...8L' },
        { type: chalk.blue('PREDICTION'), agent: 'Mempool Monitor', amount: colorPnl(0.08), wallet: 'GD9P...5N' },
        { type: chalk.red('YIELD'), agent: 'Arbitrage Tracker', amount: colorPnl(0.15), wallet: 'GF1Q...3R' },
      ];

      console.log(chalk.bold.white('  ┌─────────────────────────────────────────────────────────────────────┐'));
      console.log(chalk.bold.white('  │') + chalk.bold.green('  ⚡ RECENT ACTIVITY') + chalk.bold.white(' (via Ably · 0x402)') + chalk.bold.white('                                  │'));
      console.log(chalk.bold.white('  ├────────────────┬──────────────────────┬──────────┬─────────────────┤'));
      console.log(chalk.bold.white('  │') + chalk.bold(' Type           ') + chalk.bold.white('│') + chalk.bold(' Agent                ') + chalk.bold.white('│') + chalk.bold(' XLM      ') + chalk.bold.white('│') + chalk.bold(' Wallet          ') + chalk.bold.white('│'));
      console.log(chalk.bold.white('  ├────────────────┼──────────────────────┼──────────┼─────────────────┤'));
      for (const act of activities) {
        console.log(
          chalk.bold.white('  │') +
          ` ${act.type.padEnd(23)}` +
          chalk.bold.white('│') +
          chalk.white(` ${act.agent.padEnd(21)} `) +
          chalk.bold.white('│') +
          ` ${act.amount.padEnd(17)}` +
          chalk.bold.white('│') +
          chalk.gray(` ${act.wallet.padEnd(16)} `) +
          chalk.bold.white('│')
        );
      }
      console.log(chalk.bold.white('  └────────────────┴──────────────────────┴──────────┴─────────────────┘'));
      console.log('');
      console.log(chalk.gray(`  Refreshing every ${interval}ms  ·  Press Ctrl+C to exit`));
    }

    await render();
    const timer = setInterval(render, interval);

    process.on('SIGINT', () => {
      clearInterval(timer);
      console.log('\n' + chalk.cyan('  Dashboard closed. Goodbye! 👋\n'));
      process.exit(0);
    });
  });

console.log(BANNER);
const cliArgv = process.argv[2] === '--' ? [process.argv[0], process.argv[1], ...process.argv.slice(3)] : process.argv;
program.parseAsync(cliArgv);
