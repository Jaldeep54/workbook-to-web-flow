/**
 * Spells out a rupee amount using the Indian numbering system
 * (Lakh/Crore, not Million/Billion) for the bill's "Amount In Words" line.
 */

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function threeDigitsToWords(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(" ");
}

/** Converts a non-negative integer to Indian-numbering-system words. */
function integerToWords(n: number): string {
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const rest = n % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitsToWords(rest));

  return parts.join(" ");
}

/**
 * "Rupees Twelve Thousand Three Hundred Only" — or, when the amount has
 * paise, "Rupees Twelve Thousand Three Hundred and Fifty Paise Only".
 * Negative amounts are treated as zero (a bill total is never negative).
 */
export function amountInWords(amount: number): string {
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const rounded = Math.round(safe * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  let result = `Rupees ${integerToWords(rupees)}`;
  if (paise > 0) {
    result += ` and ${integerToWords(paise)} Paise`;
  }
  return `${result} Only`;
}
