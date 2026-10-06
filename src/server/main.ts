import { createApp } from './app.js';

export async function startServer(home: string, port: number) {
  const application = await createApp({
    home,
  });
  try {
    const url = await application.server.listen({
      port,
      host: '127.0.0.1',
    });
    return {
      url,
      token: application.localToken,
      close: () => application.server.close(),
    };
  } catch (error) {
    await application.server.close();
    throw error;
  }
}
