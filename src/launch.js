import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  decodeEventLog,
  getAddress,
  keccak256,
  parseAbi,
  parseEther,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FACTORY_ABI, LIMITS, ZERO_ADDRESS } from "./abi.js";
import { signIn, uploadImage } from "./auth.js";
import { API_ORIGIN, EXPLORER, eth, platformConfig, publicClient, robinhood } from "./chain.js";

const abi = parseAbi(FACTORY_ABI);
const attemptDir = path.join(os.homedir(), ".clank-trade");
const attemptFile = path.join(attemptDir, "attempts.json");

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}

function requireField(label, value, max, { required = false } = {}) {
  const text = value ?? "";
  const size = utf8Length(text);
  if (required && size === 0) throw new Error(`${label} là bắt buộc.`);
  if (size > max) throw new Error(`${label} dài ${size} byte, tối đa ${max}.`);
  return text;
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  throw new Error("Ảnh phải là PNG, JPEG hoặc WebP.");
}

export function accountFromEnv() {
  const key = process.env.CLANK_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error("Thiếu CLANK_PRIVATE_KEY. Đặt khóa ví dạng 0x... trong môi trường, không ghi vào file dự án.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("CLANK_PRIVATE_KEY phải là private key hex 32 byte.");
  }
  return privateKeyToAccount(key);
}

function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function readAttempts() {
  try {
    return JSON.parse(await readFile(attemptFile, "utf8"));
  } catch {
    return {};
  }
}

async function writeAttempt(key, value) {
  const all = await readAttempts();
  all[key] = value;
  await mkdir(attemptDir, { recursive: true });
  await writeFile(attemptFile, JSON.stringify(all, null, 2));
}

function buildParams({ name, symbol, logo, description, twitter, website, account, economics, salt }) {
  return {
    name,
    symbol,
    logo,
    description,
    socials: {
      twitter,
      telegram: "",
      discord: "",
      website,
      farcaster: "",
    },
    creatorFeeRecipient: account,
    creatorTaxBps: 0,
    buybackEnabled: false,
    expectedEconomics: economics,
    salt,
  };
}

export async function readPlatform() {
  const config = await platformConfig();
  const client = publicClient();
  const factory = getAddress(config.factory);
  const launchConfigId = BigInt(config.launchConfigId);
  const [enabled, fee, launchConfig, chainId] = await Promise.all([
    client.readContract({ address: factory, abi, functionName: "launchEnabled" }),
    client.readContract({ address: factory, abi, functionName: "launchFee" }),
    client.readContract({
      address: factory,
      abi,
      functionName: "getLaunchConfig",
      args: [launchConfigId],
    }),
    client.getChainId(),
  ]);
  return { config, client, factory, launchConfigId, enabled, fee, launchConfig, chainId };
}

export async function launchCoin(options) {
  const name = requireField("Tên coin", options.name?.trim(), LIMITS.name, { required: true });
  const symbol = requireField("Ticker", options.symbol?.trim().toUpperCase(), LIMITS.symbol, {
    required: true,
  });
  const description = requireField("Mô tả", options.description?.trim() ?? "", LIMITS.description);
  const twitter = requireField("Twitter", options.twitter?.trim() ?? "", LIMITS.social);
  const website = requireField("Website", options.website?.trim() ?? "", LIMITS.social);
  const buyText = (options.buy ?? "").trim();
  const quoteIn = buyText ? parseEther(buyText) : 0n;
  if (quoteIn < 0n) throw new Error("Số ETH mua ban đầu không hợp lệ.");
  const minTokensOut = options.minTokens ? parseEther(options.minTokens) : 0n;

  const account = accountFromEnv();
  const platform = await readPlatform();
  const { client, factory, launchConfigId } = platform;
  if (!platform.enabled) throw new Error("Factory đang tắt launch.");
  if (platform.chainId !== robinhood.id) throw new Error(`RPC không phải Robinhood Chain (${platform.chainId}).`);
  if (!platform.launchConfig.enabled) throw new Error("Launch config đang tắt.");

  const allowed = await client.readContract({
    address: factory,
    abi,
    functionName: "canLaunch",
    args: [account.address],
  });
  if (!allowed) throw new Error(`Ví ${account.address} chưa được phép launch trên factory này.`);

  let logo = options.logo?.trim() ?? "";
  if (options.image) {
    const bytes = new Uint8Array(await readFile(options.image));
    if (bytes.length === 0 || bytes.length > LIMITS.imageBytes) {
      throw new Error("Ảnh phải nhỏ hơn hoặc bằng 2 MB.");
    }
    const contentType = imageType(bytes);
    process.stdout.write("Đang đăng nhập clank.trade…\n");
    const session = await signIn(account);
    process.stdout.write("Đang tải ảnh lên…\n");
    logo = await uploadImage(session.jar, bytes, contentType);
  }
  logo = requireField("Logo", logo, LIMITS.logo, { required: true });

  const pairToken = getAddress(platform.config.quoteToken || ZERO_ADDRESS);
  const economics = await client.readContract({
    address: factory,
    abi,
    functionName: "previewLaunchEconomics",
    args: [launchConfigId, pairToken],
  });

  const fingerprint = keccak256(
    toBytes(
      JSON.stringify({
        chainId: platform.config.chainId,
        factory: factory.toLowerCase(),
        creator: account.address.toLowerCase(),
        name,
        symbol,
        logo,
        description,
        twitter,
        website,
        buy: quoteIn.toString(),
        launchConfigId: launchConfigId.toString(),
      }),
    ),
  );
  const saved = (await readAttempts())[fingerprint];
  const salt = options.salt || saved?.salt || randomSalt();
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new Error("Salt phải là bytes32 hex.");

  const params = buildParams({
    name,
    symbol,
    logo,
    description,
    twitter,
    website,
    account: account.address,
    economics,
    salt,
  });

  const [token, curve] = await client.readContract({
    address: factory,
    abi,
    functionName: "predictLaunch",
    args: [account.address, params, launchConfigId, pairToken],
  });
  const existing = await client.getCode({ address: token });
  const native = pairToken.toLowerCase() === ZERO_ADDRESS;
  const value = quoteIn > 0n ? platform.fee + (native ? quoteIn : 0n) : 0n;
  const request =
    quoteIn > 0n
      ? {
          address: factory,
          abi,
          functionName: "launchAndBuy",
          args: [params, launchConfigId, pairToken, quoteIn, minTokensOut, account.address, []],
          value,
        }
      : {
          address: factory,
          abi,
          functionName: "launchToken",
          args: [params, launchConfigId, pairToken],
          value,
        };

  const balance = await client.getBalance({ address: account.address });
  const summary = {
    wallet: account.address,
    name,
    symbol,
    logo,
    token,
    curve,
    value: eth(value),
    balance: eth(balance),
    buy: quoteIn > 0n ? eth(quoteIn) : "0 ETH",
    alreadyLive: Boolean(existing && existing !== "0x"),
    coinUrl: `${API_ORIGIN}/coin/${token}`,
  };

  if (summary.alreadyLive) {
    await writeAttempt(fingerprint, { salt, token, curve, logo, done: true });
    return { ...summary, sent: false, reason: "Coin với salt này đã có trên chain." };
  }

  let gas;
  try {
    gas = await client.estimateContractGas({ ...request, account: account.address });
  } catch (error) {
    const message = error?.shortMessage || error?.message || String(error);
    return { ...summary, sent: false, simulated: false, reason: message };
  }
  summary.gas = (gas * 120n) / 100n;
  summary.simulated = true;

  if (!options.yes) {
    await writeAttempt(fingerprint, { salt, token, curve, logo, done: false });
    return { ...summary, sent: false, salt, reason: "Dry-run. Thêm --yes để gửi giao dịch." };
  }
  const fees = await client.estimateFeesPerGas();
  const maxFee = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  const required = value + summary.gas * maxFee;
  if (balance < required) {
    throw new Error(`Ví không đủ ETH cho value và gas. Cần khoảng ${eth(required)}, đang có ${eth(balance)}.`);
  }

  const { createWalletClient } = await import("viem");
  const { http } = await import("viem");
  const wallet = createWalletClient({
    account,
    chain: robinhood,
    transport: http(process.env.CLANK_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"),
  });
  const hash = await wallet.writeContract({ ...request, gas: summary.gas });
  await writeAttempt(fingerprint, { salt, token, curve, logo, hash, done: false });
  process.stdout.write(`Đã gửi ${hash}. Đang chờ xác nhận…\n`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  let launchedToken = token;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, eventName: "TokenLaunched", topics: log.topics, data: log.data });
      launchedToken = decoded.args.token;
    } catch {
      // log khác của factory
    }
  }
  await writeAttempt(fingerprint, { salt, token: launchedToken, curve, logo, hash, done: receipt.status === "success" });
  if (receipt.status !== "success") {
    throw new Error(`Giao dịch revert: ${EXPLORER}/tx/${hash}`);
  }
  return {
    ...summary,
    token: launchedToken,
    coinUrl: `${API_ORIGIN}/coin/${launchedToken}`,
    sent: true,
    hash,
    txUrl: `${EXPLORER}/tx/${hash}`,
  };
}
