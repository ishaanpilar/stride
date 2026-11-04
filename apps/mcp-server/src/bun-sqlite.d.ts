declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options?: { readonly?: boolean });
    prepare(sql: string): {
      all: (...args: any[]) => any[];
      get: (...args: any[]) => any;
      run: (...args: any[]) => { changes?: number };
    };
    pragma?(sql: string): void;
    exec(sql: string): void;
    close(): void;
  }
}
