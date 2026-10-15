/** Build-time values the client bundler replaces before this code reaches a browser. */
declare const process: {
  readonly env: {
    readonly NODE_ENV?: string
    readonly [name: `DSH_CLIENT_${string}`]: string | undefined
  }
}
