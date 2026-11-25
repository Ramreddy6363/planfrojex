declare const process: { env: Record<string, string | undefined> }

export const webOrigin = () => `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '5199'}`
