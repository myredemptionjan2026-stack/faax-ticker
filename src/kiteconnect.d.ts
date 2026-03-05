declare module "kiteconnect" {
  // Minimal type declaration to satisfy TypeScript in faax-ticker.
  // For full typings, replace this with actual definitions or install official types if available.
  export class KiteTicker {
    constructor(config: { api_key: string; access_token: string });
    connect(): void;
    disconnect(): void;
    subscribe(tokens: number[]): void;
    unsubscribe(tokens: number[]): void;
    setMode(mode: any, tokens: number[]): void;
    modeLTP: any;
    modeQuote: any;
    modeFull: any;
    on(event: string, handler: (...args: any[]) => void): void;
  }
}

