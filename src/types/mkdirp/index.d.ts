declare module "mkdirp" {
  interface MkdirpOptions {
    fs?: object;
    mode: string;
  }
  export default function(dir: string, opts: MkdirpOptions | string, cb: (err: Error, dir: string) => void): void;
  export function sync(dir: string, opts?: MkdirpOptions | string): string;
}
