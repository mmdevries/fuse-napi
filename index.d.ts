declare namespace Fuse {
  export type Result = number | null | undefined;
  export type Int64 = number | bigint;
  export type Uint64 = number | bigint;
  export type FileHandle = Uint64;

  export interface FileInfoResult {
    fd?: FileHandle;
    directIO?: boolean;
    keepCache?: boolean;
    nonseekable?: boolean;
  }

  export interface ConnectionInfo {
    readonly protoMajor: number;
    readonly protoMinor: number;
    readonly asyncRead: boolean;
    readonly maxWrite: number;
    readonly maxReadahead: number;
    readonly capable: number;
    readonly want: number;
    readonly maxBackground: number;
    readonly congestionThreshold: number;
  }

  export interface InitConfig {
    maxWrite?: number;
    maxReadahead?: number;
    maxBackground?: number;
    congestionThreshold?: number;
    want?: number;
  }

  // Stats object produced by fuse-native index.js function getStatArray
  export interface Stats {
    mode?: number;
    uid?: number;
    gid?: number;
    size?: Uint64;
    dev?: Uint64;
    nlink?: Uint64;
    ino?: Uint64;
    rdev?: Uint64;
    blksize?: Uint64;
    blocks?: Uint64;
    atime?: Date | Int64;
    mtime?: Date | Int64;
    ctime?: Date | Int64;
  }

  export interface Statfs {
    bsize?: Uint64;
    frsize?: Uint64;
    blocks?: Uint64;
    bfree?: Uint64;
    bavail?: Uint64;
    files?: Uint64;
    ffree?: Uint64;
    favail?: Uint64;
    fsid?: Uint64;
    flag?: Uint64;
    namemax?: Uint64;
  }

  export interface CommonOperations {
    access?: (path: string, mode: number, cb: (err: Result) => void) => void;
    statfs?: (path: string, cb: (err: Result, stats?: Statfs) => void) => void;
    fgetattr?: (
        path: string,
        fd: FileHandle,
        cb: (err: Result, stat?: Stats) => void
    ) => void;
    getattr?: (
        path: string,
        cb: (err: Result, stat?: Stats) => void
    ) => void;
    flush?: (path: string, fd: FileHandle, cb: (err: Result) => void) => void;
    fsync?: (path: string, dataSync: boolean, fd: FileHandle, cb: (err: Result) => void) => void;
    fsyncdir?: (path: string, dataSync: boolean, fd: FileHandle, cb: (err: Result) => void) => void;
    truncate?: (path: string, size: Int64, cb: (err: Result) => void) => void;
    ftruncate?: (path: string, fd: FileHandle, size: Int64, cb: (err: Result) => void) => void;
    utimens?: (path: string, atime: Int64, mtime: Int64, cb: (err: Result) => void) => void;
    readlink?: (path: string, cb: (err: Result, linkName?: string) => void) => void;
    chown?: (path: string, uid: number, gid: number, cb: (err: Result) => void) => void;
    chmod?: (path: string, mode: number, cb: (err: Result) => void) => void;
    mknod?: (path: string, mode: number, dev: Uint64, cb: (err: Result) => void) => void;
    setxattr?: (
        path: string,
        name: string,
        value: Buffer,
        position: number,
        flags: number,
        cb: (err: Result) => void
    ) => void;
    getxattr?: (
        path: string,
        name: string,
        position: number,
        cb: (err: Result, value?: Buffer | null) => void
    ) => void;
    listxattr?: (path: string, cb: (err: Result, list?: string[]) => void) => void;
    removexattr?: (path: string, name: string, cb: (err: Result) => void) => void;
    open?: (
        path: string,
        flags: number,
        cb: (err: Result, result?: FileHandle | FileInfoResult) => void
    ) => void;
    opendir?: (
        path: string,
        flags: number,
        cb: (err: Result, result?: FileHandle | FileInfoResult) => void
    ) => void;
    read?: (
        path: string,
        fd: FileHandle,
        buffer: Buffer,
        length: number,
        position: Int64,
        cb: (result: number) => void
    ) => void;
    write?: (
        path: string,
        fd: FileHandle,
        buffer: Buffer,
        length: number,
        position: Int64,
        cb: (result: number) => void
    ) => void;
    // For every open() call there will be exactly one release() call with the same flags and
    // file handle. It is possible to have a file opened more than once, in which case only the
    // last release will mean, that no more reads/writes will happen on the file. The return
    // value of release is ignored.
    release?: (path: string, fd: FileHandle, cb: (err: Result) => void) => void;
    releasedir?: (path: string, fd: FileHandle, cb: (err: Result) => void) => void;
    unlink?: (path: string, cb: (err: Result) => void) => void;
    rename?: (src: string, dest: string, cb: (err: Result) => void) => void;
    link?: (src: string, dest: string, cb: (err: Result) => void) => void;
    symlink?: (src: string, dest: string, cb: (err: Result) => void) => void;
    mkdir?: (path: string, mode: number, cb: (err: Result) => void) => void;
    rmdir?: (path: string, cb: (err: Result) => void) => void;
  }

  export type OPERATIONS = CommonOperations & (
    | {
        init?: (cb: (err: Result) => void) => void;
        initWithConfig?: never;
      }
    | {
        init?: never;
        initWithConfig?: (
            connection: Readonly<ConnectionInfo>,
            cb: (err: Result, config?: InitConfig) => void
        ) => void;
      }
  ) & (
    | {
        readdir?: (path: string, cb: (err: Result, names?: string[], stats?: Stats[]) => void) => void;
        readdirPaged?: never;
      }
    | {
        readdir?: never;
        readdirPaged?: (
            path: string,
            fd: FileHandle,
            offset: Int64,
            cb: (err: Result, names?: string[], stats?: Stats[], nextOffsets?: Int64[]) => void
        ) => void;
      }
  ) & (
    | {
        create?: (
            path: string,
            mode: number,
            cb: (err: Result, result?: FileHandle | FileInfoResult) => void
        ) => void;
        createWithFlags?: never;
      }
    | {
        create?: never;
        createWithFlags?: (
            path: string,
            mode: number,
            flags: number,
            cb: (err: Result, result?: FileHandle | FileInfoResult) => void
        ) => void;
      }
  );

  export interface Timeouts {
    default?: number | false;
    init?: number | false;
    [operation: string]: number | false | undefined;
  }

  // See https://github.com/refinio/fuse-native
  export interface OPTIONS {
    uid?: number;
    gid?: number;
    timeout?: number | false | Timeouts;
    displayFolder?: boolean;
    debug?: boolean;
    force?: boolean;
    mkdir?: boolean;
    allowOther?: boolean;
    allowRoot?: boolean;
    autoUnmount?: boolean;
    defaultPermissions?: boolean;
    blkdev?: boolean;
    blksize?: number;
    maxRead?: number;
    nonEmpty?: boolean;
    fd?: number;
    userId?: number;
    fsname?: string;
    subtype?: string;
    kernelCache?: boolean;
    autoCache?: boolean;
    umask?: number;
    entryTimeout?: number;
    attrTimeout?: number;
    acAttrTimeout?: number;
    noforget?: boolean;
    remember?: number;
    modules?: string;
    name?: string;
    onError?: (error: unknown, operation: string, args: readonly unknown[]) => void;
  }
}

declare class Fuse {
  constructor(mnt: string, ops?: Fuse.OPERATIONS, opts?: Fuse.OPTIONS);

  static unmount(mnt: string, cb?: (err: null | Error) => void): void;

  // Error codes - numeric value retrieved from Fuse instance with errno(code)
  static EPERM: number;
  static ENOENT: number;
  static ESRCH: number;
  static EINTR: number;
  static EIO: number;
  static ENXIO: number;
  static E2BIG: number;
  static ENOEXEC: number;
  static EBADF: number;
  static ECHILD: number;
  static EAGAIN: number;
  static ENOMEM: number;
  static EACCES: number;
  static EFAULT: number;
  static ENOTBLK: number;
  static EBUSY: number;
  static EEXIST: number;
  static EXDEV: number;
  static ENODEV: number;
  static ENOTDIR: number;
  static EISDIR: number;
  static EINVAL: number;
  static ENFILE: number;
  static EMFILE: number;
  static ENOTTY: number;
  static ETXTBSY: number;
  static EFBIG: number;
  static ENOSPC: number;
  static ESPIPE: number;
  static EROFS: number;
  static EMLINK: number;
  static EPIPE: number;
  static EDOM: number;
  static ERANGE: number;
  static EDEADLK: number;
  static ENAMETOOLONG: number;
  static ENOLCK: number;
  static ENOSYS: number;
  static ENOTEMPTY: number;
  static ELOOP: number;
  static EWOULDBLOCK: number;
  static ENOMSG: number;
  static EIDRM: number;
  static ECHRNG: number;
  static EL2NSYNC: number;
  static EL3HLT: number;
  static EL3RST: number;
  static ELNRNG: number;
  static EUNATCH: number;
  static ENOCSI: number;
  static EL2HLT: number;
  static EBADE: number;
  static EBADR: number;
  static EXFULL: number;
  static ENOANO: number;
  static EBADRQC: number;
  static EBADSLT: number;
  static EDEADLOCK: number;
  static EBFONT: number;
  static ENOSTR: number;
  static ENODATA: number;
  static ETIME: number;
  static ENOSR: number;
  static ENONET: number;
  static ENOPKG: number;
  static EREMOTE: number;
  static ENOLINK: number;
  static EADV: number;
  static ESRMNT: number;
  static ECOMM: number;
  static EPROTO: number;
  static EMULTIHOP: number;
  static EDOTDOT: number;
  static EBADMSG: number;
  static EOVERFLOW: number;
  static ENOTUNIQ: number;
  static EBADFD: number;
  static EREMCHG: number;
  static ELIBACC: number;
  static ELIBBAD: number;
  static ELIBSCN: number;
  static ELIBMAX: number;
  static ELIBEXEC: number;
  static EILSEQ: number;
  static ERESTART: number;
  static ESTRPIPE: number;
  static EUSERS: number;
  static ENOTSOCK: number;
  static EDESTADDRREQ: number;
  static EMSGSIZE: number;
  static EPROTOTYPE: number;
  static ENOPROTOOPT: number;
  static EPROTONOSUPPORT: number;
  static ESOCKTNOSUPPORT: number;
  static EOPNOTSUPP: number;
  static ENOTSUP: number;
  static EPFNOSUPPORT: number;
  static EAFNOSUPPORT: number;
  static EADDRINUSE: number;
  static EADDRNOTAVAIL: number;
  static ENETDOWN: number;
  static ENETUNREACH: number;
  static ENETRESET: number;
  static ECONNABORTED: number;
  static ECONNRESET: number;
  static ENOBUFS: number;
  static EISCONN: number;
  static ENOTCONN: number;
  static ESHUTDOWN: number;
  static ETOOMANYREFS: number;
  static ETIMEDOUT: number;
  static ECONNREFUSED: number;
  static EHOSTDOWN: number;
  static EHOSTUNREACH: number;
  static EALREADY: number;
  static EINPROGRESS: number;
  static ESTALE: number;
  static EUCLEAN: number;
  static ENOTNAM: number;
  static ENAVAIL: number;
  static EISNAM: number;
  static EREMOTEIO: number;
  static EDQUOT: number;
  static ENOMEDIUM: number;
  static EMEDIUMTYPE: number;
  static ECANCELED: number;

  public opts: Fuse.OPTIONS;
  public mnt: string;
  public ops: Fuse.OPERATIONS;
  public timeout: number | Fuse.Timeouts;

  public mount: (cb: (err?: null | Error) => any) => void;
  public unmount: (cb: (err: null | Error) => any) => void;
  public errno: (code?: string) => number;

  // From "nanoresource"
  // See https://github.com/mafintosh/nanoresource/blob/master/index.js
  public opening: boolean;
  public opened: boolean;
  public closing: boolean;
  public closed: boolean;
  public actives: number;

  public open(cb: (err?: Error) => any): void;

  public active(cb?: (err?: Error) => any): boolean;

  public inactive(): void;
  public inactive(cb: (err: Error, val: any) => any, err: null, val: any): void;
  public inactive(cb: (err: Error, val: any) => any, err: Error): void;

  public close(cb?: (err?: Error) => any): void;
  public close(allowActive: boolean, cb: (err?: Error) => any): void;
}

export = Fuse;
