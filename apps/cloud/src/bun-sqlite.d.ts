declare module 'bun:sqlite' {
    export class Database {
        constructor(path: string, options?: { readonly?: boolean });
        exec(sql: string): void;
        close(): void;
    }
}
