/**
 * Собирает отчёт о прогоне выпуска в devnet: все транзакции по аккаунту
 * сделки и по аккаунту реестра, в порядке времени, с названием инструкции.
 *
 * Название берётся из логов, а не придумывается: Anchor пишет туда
 * `Program log: Instruction: …` на каждый вызов. Поэтому отчёт нельзя
 * нарисовать — он либо собирается из цепочки, либо не собирается.
 *
 *   node scripts/devnet-run.mjs <адрес сделки> <адрес реестра> > ../docs/devnet-run.md
 *
 * Публичный RPC режет частоту, поэтому между запросами пауза, а на 429 —
 * повтор. Прогон занимает около минуты.
 */
import { Connection, PublicKey } from '@solana/web3.js';

const [deal, registry] = process.argv.slice(2);
if (!deal || !registry) {
  console.error('Нужны два адреса: аккаунт сделки и аккаунт реестра выпуска');
  process.exit(1);
}

const RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Повтор на 429: публичный узел отвечает отказом чаще, чем хотелось бы. */
async function withRetry(call, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await pause(400 * 2 ** attempt);
    }
  }
}

const rows = new Map();
for (const address of [deal, registry]) {
  const signatures = await withRetry(() =>
    conn.getSignaturesForAddress(new PublicKey(address), { limit: 200 }),
  );
  for (const item of signatures) {
    if (rows.has(item.signature)) continue;
    const tx = await withRetry(() =>
      conn.getTransaction(item.signature, { maxSupportedTransactionVersion: 0 }),
    );
    await pause(250);
    const instructions = (tx?.meta?.logMessages ?? [])
      .filter((line) => line.startsWith('Program log: Instruction: '))
      .map((line) => line.replace('Program log: Instruction: ', ''));
    rows.set(item.signature, {
      time: new Date(item.blockTime * 1000).toISOString().replace('T', ' ').slice(0, 19),
      instructions,
      failed: Boolean(item.err),
    });
  }
}

const sorted = [...rows.entries()].sort((a, b) =>
  a[1].time < b[1].time ? -1 : a[1].time > b[1].time ? 1 : 0,
);

const link = (signature) =>
  `[\`${signature.slice(0, 8)}…\`](https://explorer.solana.com/tx/${signature}?cluster=devnet)`;

console.log('| # | Время, UTC | Инструкции | Транзакция |');
console.log('|---|---|---|---|');
sorted.forEach(([signature, row], index) => {
  const names = row.instructions.length
    ? row.instructions.map((name) => `\`${name}\``).join(' + ')
    : '—';
  const mark = row.failed ? ' **ошибка**' : '';
  console.log(`| ${index + 1} | ${row.time} | ${names}${mark} | ${link(signature)} |`);
});
console.error(`Собрано транзакций: ${sorted.length}`);
