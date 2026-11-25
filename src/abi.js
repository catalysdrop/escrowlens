// Minimal ABI helpers for AgentEscrow events + escrowOf().
// No ethers dependency: topics and calldata are decoded by hand.
// Event signatures are taken from contracts/src/AgentEscrow.sol; topic0
// hashes were computed with `cast keccak` and verified against live logs.

// topic0 (keccak256 of the canonical signature) -> event name.
export const TOPICS = {
  "0x4e16ba5c82533319fa6aef79f24dc2b6e34146279954fa56f24c6e00da474520":
    "EscrowCreated",
  "0xa6bd58fcd4da90af9fea785d8cf919f762887f0f05b0656fb2ac5f7227183d5a":
    "Delivered",
  "0xec91978c08536b8f9571b36a7053ce3081a42b64b2783c715dc15702e51b0b91":
    "DeliveryRejected",
  "0xc8fa66dff4b9073528c3f1bf21a8dc9a18fdf09847e88e96188bc953aef519f0":
    "Released",
  "0xf552ca82e113ac3c539c3d617f29fcd19c172a0c75dad017555c9e109f7fe183":
    "Refunded",
};

export const TOPIC_LIST = Object.keys(TOPICS);

// escrowOf(bytes32) — verified live via eth_call on v2, 24 Nov 2026.
export const ESCOW_OF_SELECTOR = "0x83a265a7";

// AgentEscrow.Status enum order.
export const STATUS = ["None", "Created", "Delivered", "Released", "Refunded"];

export function topicToAddress(topic) {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

export function wordToBigInt(word) {
  return BigInt(word);
}

export function wordToNumber(word) {
  return Number(BigInt(word));
}

function dataWords(data) {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const words = [];
  for (let i = 0; i < hex.length; i += 64) words.push("0x" + hex.slice(i, i + 64));
  return words;
}

/**
 * Decode one eth_getLogs entry from an AgentEscrow contract.
 * Returns null for logs that are not AgentEscrow events.
 */
export function decodeLog(log) {
  const event = TOPICS[(log.topics?.[0] ?? "").toLowerCase()];
  if (!event) return null;
  const t = log.topics;
  const words = dataWords(log.data ?? "0x");
  const base = {
    event,
    taskId: t[1] ?? null,
    blockNumber: wordToNumber(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: wordToNumber(log.logIndex),
    contract: (log.address ?? "").toLowerCase(),
  };
  switch (event) {
    case "EscrowCreated":
      return {
        ...base,
        client: topicToAddress(t[2]),
        agent: topicToAddress(t[3]),
        amount: wordToBigInt(words[0]),
        deadline: wordToNumber(words[1]),
      };
    case "Delivered":
      return { ...base, agent: topicToAddress(t[2]), proof: t[3] ?? words[0] };
    case "DeliveryRejected":
      return { ...base, client: topicToAddress(t[2]) };
    case "Released":
      return {
        ...base,
        agent: topicToAddress(t[2]),
        amount: wordToBigInt(words[0]),
      };
    case "Refunded":
      return {
        ...base,
        client: topicToAddress(t[2]),
        amount: wordToBigInt(words[0]),
      };
    default:
      return null;
  }
}

/** Build eth_call calldata for escrowOf(taskId). taskId is a 0x bytes32 hex. */
export function encodeEscrowOf(taskId) {
  const id = taskId.startsWith("0x") ? taskId.slice(2) : taskId;
  return ESCOW_OF_SELECTOR + id.padStart(64, "0");
}

/**
 * Decode the escrowOf() return tuple:
 * (address client, address agent, uint256 amount, uint64 deadline,
 *  uint64 deliveredAt, bytes32 proof, uint8 status)
 */
export function decodeEscrowOf(hex) {
  const words = dataWords(hex);
  if (words.length < 7) throw new Error(`escrowOf: short return (${words.length} words)`);
  return {
    client: topicToAddress(words[0]),
    agent: topicToAddress(words[1]),
    amount: wordToBigInt(words[2]),
    deadline: wordToNumber(words[3]),
    deliveredAt: wordToNumber(words[4]),
    proof: words[5],
    status: wordToNumber(words[6]),
    statusName: STATUS[wordToNumber(words[6])] ?? "Unknown",
  };
}
