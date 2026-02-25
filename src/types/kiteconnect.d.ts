// kiteconnect has no official @types package — declare module to silence TS7016
declare module "kiteconnect" {
  export class KiteConnect {
    constructor(params: { api_key: string; access_token?: string });
    generateSession(requestToken: string, apiSecret: string): Promise<{ access_token: string; user_id: string }>;
    getHistoricalData(token: string, interval: string, from: Date, to: Date, continuous: boolean, oi: boolean): Promise<unknown[]>;
    getOHLC(instruments: string[]): Promise<Record<string, unknown>>;
    getInstruments(exchange: string): Promise<unknown[]>;
    placeOrder(variety: string, params: Record<string, unknown>): Promise<{ order_id: string }>;
  }

  export class KiteTicker {
    modeLTP:   string;
    modeQuote: string;
    modeFull:  string;

    constructor(params: { api_key: string; access_token: string });
    connect(): void;
    disconnect(): void;
    subscribe(tokens: number[]): void;
    unsubscribe(tokens: number[]): void;
    setMode(mode: string, tokens: number[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, cb: (...args: any[]) => void): void;
  }
}
