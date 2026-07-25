import { NCWebsocket } from 'node-napcat-ts';
import { NapCatError } from './error.js';
import type { NapCatClient, NapCatClientOptions, NapCatConfig, NapCatFactory } from './types.js';

export class NapCatConnection {
  readonly #config: NapCatConfig;
  readonly #factory: NapCatFactory;
  readonly #destroyController = new AbortController();

  #client?: NapCatClient;
  #connection?: Promise<NapCatClient>;
  #destroyPromise?: Promise<void>;

  public constructor(config: NapCatConfig, factory: NapCatFactory = createNapCatClient) {
    this.#config = config;
    this.#factory = factory;
  }

  get destroySignal(): AbortSignal {
    return this.#destroyController.signal;
  }

  public connect(): Promise<NapCatClient> {
    if (this.#destroyController.signal.aborted) {
      return Promise.reject(new NapCatError('ABORTED', 'NapCat adapter has been destroyed.'));
    }
    if (this.#connection) return this.#connection;

    const client = this.#factory({
      baseUrl: this.#config.base_url,
      ...(this.#config.access_token ? { accessToken: this.#config.access_token } : {}),
      apiTimeout: this.#config.timeout_ms
    });
    this.#client = client;
    const connection = client
      .connect()
      .then(async () => {
        if (this.#destroyController.signal.aborted) {
          await client.disconnect();
          throw new NapCatError('ABORTED', 'NapCat adapter has been destroyed.');
        }
        return client;
      })
      .catch(async (error: unknown) => {
        if (this.#connection === connection) {
          this.#connection = undefined;
          this.#client = undefined;
          await client.disconnect().catch(() => undefined);
        }
        throw error;
      });
    this.#connection = connection;
    return connection;
  }

  public destroy(): Promise<void> {
    if (this.#destroyPromise) return this.#destroyPromise;
    this.#destroyController.abort();
    const client = this.#client;
    this.#connection = undefined;
    this.#client = undefined;
    this.#destroyPromise = client?.disconnect() ?? Promise.resolve();
    return this.#destroyPromise;
  }
}

function createNapCatClient(options: NapCatClientOptions): NapCatClient {
  return new NCWebsocket(
    {
      baseUrl: options.baseUrl,
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
      apiTimeout: options.apiTimeout,
      reconnection: { enable: false }
    },
    false
  );
}
