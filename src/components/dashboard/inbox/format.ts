// Number formatting shared by the inbox token report (server page and client components).

const nf = new Intl.NumberFormat("en-US");

export const formatTokens = (value: number) => nf.format(Math.round(value));

/** USD from micros; tiny amounts keep enough digits to not read as $0.0000. */
export const formatCost = (micros: number) => `$${(micros / 1_000_000).toFixed(micros > 0 && micros < 100 ? 6 : 4)}`;
