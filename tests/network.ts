import { once } from 'node:events';
import { type AddressInfo, createServer } from 'node:net';

export async function availablePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as AddressInfo).port;
  const closed = once(listener, 'close');
  listener.close();
  await closed;
  return port;
}
