/**
 * Инициализация платформы на devnet после `anchor deploy --provider.cluster devnet`.
 *
 * Платит и подписывает кошелёк деплоя (~/.config/solana/id.json). Роли — публичные ключи
 * из backend/.secrets/devnet. Токены разрешает admin через интерфейс (`allow_mint`).
 *
 * Запуск из dala_capital/:  npx ts-node scripts/init-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DalaCapital } from "../target/types/dala_capital";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ROOT = path.resolve(__dirname, "..");
const SECRETS = path.resolve(ROOT, "../backend/.secrets/devnet");

const loadKeypair = (file: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
const rolePubkey = (role: string) => loadKeypair(path.join(SECRETS, `${role}.json`)).publicKey;

async function main() {
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/dala_capital.json"), "utf8"));
  const program = new Program<DalaCapital>(idl, provider);

  const [platform] = PublicKey.findProgramAddressSync([Buffer.from("platform")], program.programId);
  const roles = {
    admin: rolePubkey("admin"),
    operator: rolePubkey("operator"),
    whitelist: rolePubkey("whitelist"),
    treasury: rolePubkey("treasury"),
  };

  const existing = await connection.getAccountInfo(platform);
  if (existing) {
    const state = await program.account.platform.fetch(platform);
    console.log("Платформа уже инициализирована:", platform.toBase58());
    console.log({
      admin: state.admin.toBase58(),
      operator: state.operator.toBase58(),
      whitelistAuthority: state.whitelistAuthority.toBase58(),
      treasury: state.treasury.toBase58(),
      allowedMints: state.allowedMints.map((m) => m.toBase58()),
    });
    return;
  }

  const signature = await program.methods
    .initPlatform(roles.admin, roles.operator, roles.whitelist, roles.treasury)
    .accountsPartial({
      payer: payer.publicKey,
      platform,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Платформа инициализирована:", platform.toBase58());
  console.log("Транзакция:", `https://solscan.io/tx/${signature}?cluster=devnet`);
  console.log(Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.toBase58()])));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
