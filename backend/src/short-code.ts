import { randomInt } from "node:crypto";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SHORT_CODE_LENGTH = 7;

export function generateShortCode(length = SHORT_CODE_LENGTH): string {
  let code = "";

  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}
