type ReaderResult<T> = { done: boolean; value?: T };
type StreamReader<T> = {
  read: () => Promise<ReaderResult<T>>;
  releaseLock: () => void;
};
type StreamLike<T> = { getReader: () => StreamReader<T> };

export function installWebviewPolyfills() {
  if (typeof ReadableStream === "undefined") return;
  const prototype = ReadableStream.prototype as ReadableStream<unknown> & {
    [Symbol.asyncIterator]?: () => AsyncGenerator<unknown, void, unknown>;
  };
  if (prototype[Symbol.asyncIterator]) return;
  Object.defineProperty(prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: StreamLike<unknown>) {
      const reader = this.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}
