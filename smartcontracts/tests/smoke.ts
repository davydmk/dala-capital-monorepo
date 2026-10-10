import { expect } from "chai";
import { Env, pk } from "./helpers";

describe("smoke", () => {
  it("загружает программу, создаёт платформу и разрешает токен", async () => {
    const env = await Env.create();
    const platform = env.platform();
    expect(platform.admin.toBase58()).to.eq(env.admin.address);
    expect(platform.operator.toBase58()).to.eq(env.operator.address);
    expect(platform.allowedMints.map((m: any) => m.toBase58())).to.deep.eq([env.mint.toBase58()]);

    const { userId, withdrawal } = await env.createUser();
    const user = env.user(userId);
    expect(user.withdrawalAddress.toBase58()).to.eq(withdrawal.toBase58());
    expect(user.whitelistStatus).to.eq(true);
    expect(pk(env.treasury)).to.not.eq(undefined);
  });
});
