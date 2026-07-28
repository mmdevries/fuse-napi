#define FUSE_USE_VERSION 29

#include <uv.h>
#include <node_api.h>
#include <napi-macros.h>

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <math.h>
#include <stdbool.h>
#include <stdatomic.h>

#include <fuse.h>
#include <fuse_opt.h>
#include <fuse_common.h>
#include <fuse_lowlevel.h>

#include <unistd.h>
#include <sys/wait.h>
#include <pthread.h>

typedef struct fuse_thread_s fuse_thread_t;
typedef struct fuse_thread_locals_s fuse_thread_locals_t;
typedef void (*fuse_dispatch_fn)(uv_async_t *, fuse_thread_locals_t *, fuse_thread_t *);
static void fuse_native_complete_local(fuse_thread_locals_t *l, int32_t result);

#define FUSE_NATIVE_CALLBACK(fn, blk)\
  napi_env env = ft->env;\
  napi_handle_scope scope;\
  if (napi_open_handle_scope(env, &scope) != napi_ok) {\
    fuse_native_complete_local(l, -EIO);\
    return;\
  }\
  napi_value ctx;\
  napi_value callback;\
  if (napi_get_reference_value(env, ft->ctx, &ctx) != napi_ok ||\
      napi_get_reference_value(env, fn, &callback) != napi_ok) {\
    napi_close_handle_scope(env, scope);\
    fuse_native_complete_local(l, -EIO);\
    return;\
  }\
  blk\
  napi_close_handle_scope(env, scope);

#define FUSE_NATIVE_HANDLER(name, blk)\
  fuse_thread_locals_t *l = get_thread_locals();\
  if (l == NULL) return -EIO;\
  l->op = op_##name;\
  l->op_fn = fuse_native_dispatch_##name;\
  blk\
  atomic_store(&(l->waiting), 1);\
  if (uv_async_send(&(l->async)) < 0) {\
    atomic_store(&(l->waiting), 0);\
    return -EIO;\
  }\
  uv_sem_wait(&(l->sem));\
  return l->res;

#define FUSE_CALL_CALLBACK(argc, argv)\
  napi_status callback_status = napi_make_callback(env, NULL, ctx, callback, argc, argv, NULL);\
  if (callback_status != napi_ok) {\
    napi_value callback_exception = NULL;\
    if (callback_status == napi_pending_exception) {\
      napi_get_and_clear_last_exception(env, &callback_exception);\
    }\
    napi_close_handle_scope(env, scope);\
    fuse_native_complete_local(l, -EIO);\
    if (callback_exception != NULL) napi_fatal_exception(env, callback_exception);\
    return;\
  }

#define FUSE_METHOD(name, callbackArgs, signalArgs, signature, callBlk, callbackBlk, signalBlk)\
  static void fuse_native_dispatch_##name (uv_async_t* handle, fuse_thread_locals_t* l, fuse_thread_t* ft) {\
    (void) handle;\
    uint32_t op = op_##name;\
    FUSE_NATIVE_CALLBACK(ft->handlers[op], {\
      napi_value argv[callbackArgs + 2] = {0};\
      napi_get_reference_value(env, l->self, &(argv[0]));\
      napi_create_uint32(env, l->op, &(argv[1]));\
      callbackBlk\
      FUSE_CALL_CALLBACK(callbackArgs + 2, argv)\
    })\
  }\
  NAPI_METHOD(fuse_native_signal_##name) {\
    NAPI_ARGV(signalArgs + 2)\
    NAPI_ARGV_BUFFER_CAST(fuse_thread_locals_t *, l, 0);\
    NAPI_ARGV_INT32(res, 1);\
    signalBlk\
    fuse_native_complete_local(l, res);\
    return NULL;\
  }\
  static int fuse_native_##name signature {\
    FUSE_NATIVE_HANDLER(name, callBlk)\
  }

#define FUSE_METHOD_VOID(name, callbackArgs, signalArgs, signature, callBlk, callbackBlk)\
  FUSE_METHOD(name, callbackArgs, signalArgs, signature, callBlk, callbackBlk, {})

#define FUSE_UINT64_TO_INTS_ARGV(n, pos)\
  uint64_t bits##pos = (uint64_t) (n);\
  uint32_t low##pos = (uint32_t) (bits##pos & UINT32_MAX);\
  uint32_t high##pos = (uint32_t) (bits##pos >> 32);\
  napi_create_uint32(env, low##pos, &(argv[pos]));\
  napi_create_uint32(env, high##pos, &(argv[pos + 1]));

#define FUSE_CREATE_UINT64_ARGV(n, pos)\
  if (create_uint64_value(env, (uint64_t) (n), &(argv[pos])) != napi_ok) {\
    fuse_native_complete_local(l, -EIO);\
    napi_close_handle_scope(env, scope);\
    return;\
  }

#define FUSE_CREATE_OWNED_BUFFER_ARGV(source, length, pos)\
  if (create_owned_buffer(env, source, length, &(argv[pos])) != napi_ok) {\
    fuse_native_complete_local(l, -EIO);\
    napi_close_handle_scope(env, scope);\
    return;\
  }


// Opcodes

static const uint32_t op_init = 0;
static const uint32_t op_error = 1;
static const uint32_t op_access = 2;
static const uint32_t op_statfs = 3;
static const uint32_t op_fgetattr = 4;
static const uint32_t op_getattr = 5;
static const uint32_t op_flush = 6;
static const uint32_t op_fsync = 7;
static const uint32_t op_fsyncdir = 8;
static const uint32_t op_readdir = 9;
static const uint32_t op_truncate = 10;
static const uint32_t op_ftruncate = 11;
static const uint32_t op_utimens = 12;
static const uint32_t op_readlink = 13;
static const uint32_t op_chown = 14;
static const uint32_t op_chmod = 15;
static const uint32_t op_mknod = 16;
static const uint32_t op_setxattr = 17;
static const uint32_t op_getxattr = 18;
static const uint32_t op_listxattr = 19;
static const uint32_t op_removexattr = 20;
static const uint32_t op_open = 21;
static const uint32_t op_opendir = 22;
static const uint32_t op_read = 23;
static const uint32_t op_write = 24;
static const uint32_t op_release = 25;
static const uint32_t op_releasedir = 26;
static const uint32_t op_create = 27;
static const uint32_t op_unlink = 28;
static const uint32_t op_rename = 29;
static const uint32_t op_link = 30;
static const uint32_t op_symlink = 31;
static const uint32_t op_mkdir = 32;
static const uint32_t op_rmdir = 33;
#define FUSE_OPERATION_COUNT 34

// Data structures

struct fuse_thread_s {
  napi_env env;
  uv_loop_t *loop;
  pthread_t thread;
  pthread_attr_t attr;
  napi_ref ctx;
  napi_ref state_ref;
  napi_ref cleanup_cb;

  // Operation handlers
  napi_ref handlers[FUSE_OPERATION_COUNT];

  struct fuse *fuse;
  struct fuse_chan *ch;
  char *mnt;
  char *mntopts;
  int mounted;
  int thread_started;
  int attr_initialized;
  int mutex_initialized;
  int sem_initialized;
  int async_initialized;
  atomic_int cleanup_scheduled;
  int env_cleanup;
  int cleanup_error;
  int async_init_status;
  size_t close_pending;
  fuse_thread_locals_t *locals;
  napi_async_cleanup_hook_handle cleanup_hook;

  uv_async_t async;
  uv_mutex_t mut;
  uv_sem_t sem;
  uv_work_t cleanup_work;
};

struct fuse_thread_locals_s {
  napi_ref self;

  // Opcode
  uint32_t op;
  fuse_dispatch_fn op_fn;

  // Payloads
  const char *path;
  const char *dest;
  char *linkname;
  struct fuse_file_info *info;
  struct fuse_conn_info *conn;
  const void *buf;
  off_t offset;
  size_t len;
  mode_t mode;
  int int_value;
  dev_t dev;
  uid_t uid;
  gid_t gid;
  int64_t atime;
  int64_t mtime;
  int32_t res;

  // Extended attributes
  const char *name;
  const char *value;
  char *list;
  size_t size;
  uint32_t position;
  int flags;

  // Stat + Statfs
  struct stat *stat;
  struct statvfs *statvfs;

  // Readdir
  fuse_fill_dir_t readdir_filler;

  // Internal bookkeeping
  fuse_thread_t *fuse;
  uv_sem_t sem;
  uv_async_t async;
  int sem_initialized;
  int async_initialized;
  atomic_int waiting;
  fuse_thread_locals_t *next;

};

static void fuse_native_complete_local (fuse_thread_locals_t *l, int32_t result) {
  if (atomic_exchange(&(l->waiting), 0) == 1) {
    l->res = result;
    uv_sem_post(&(l->sem));
  }
}

static pthread_key_t thread_locals_key;
static pthread_once_t thread_locals_once = PTHREAD_ONCE_INIT;
static int thread_locals_status = 0;
static fuse_thread_locals_t* get_thread_locals(void);

static void create_thread_locals_key (void) {
  thread_locals_status = pthread_key_create(&(thread_locals_key), NULL);
}

// Helpers
// TODO: Extract into a separate file.

static uint64_t uint32s_to_uint64 (uint32_t **ints) {
  uint64_t low = *((*ints)++);
  uint64_t high = *((*ints)++);
  return (high << 32) | low;
}

static int64_t uint32s_to_int64 (uint32_t **ints) {
  return (int64_t) uint32s_to_uint64(ints);
}

static void uint32s_to_timespec (struct timespec* ts, uint32_t** ints) {
  int64_t ms = uint32s_to_int64(ints);
  int64_t seconds = ms / 1000;
  int64_t remainder = ms % 1000;
  if (remainder < 0) {
    seconds--;
    remainder += 1000;
  }
  ts->tv_sec = (time_t) seconds;
  ts->tv_nsec = (long) (remainder * 1000000);
}

static int timespec_to_int64 (const struct timespec* ts, int64_t *result) {
  int64_t seconds = (int64_t) ts->tv_sec;
  int64_t milliseconds = (int64_t) ts->tv_nsec / 1000000;
  if ((time_t) seconds != ts->tv_sec ||
      seconds > INT64_MAX / 1000 ||
      seconds < INT64_MIN / 1000) {
    return -EOVERFLOW;
  }
  int64_t base = seconds * 1000;
  if ((milliseconds > 0 && base > INT64_MAX - milliseconds) ||
      (milliseconds < 0 && base < INT64_MIN - milliseconds)) {
    return -EOVERFLOW;
  }
  *result = base + milliseconds;
  return 0;
}

static int populate_stat (uint32_t *ints, struct stat* stat) {
  memset(stat, 0, sizeof(*stat));
  uint32_t mode = *ints++;
  stat->st_mode = (mode_t) mode;
  if ((uint32_t) stat->st_mode != mode) return -ERANGE;
  stat->st_uid = *ints++;
  stat->st_gid = *ints++;
  uint64_t size = uint32s_to_uint64(&ints);
  uint64_t dev = uint32s_to_uint64(&ints);
  uint64_t nlink = uint32s_to_uint64(&ints);
  uint64_t ino = uint32s_to_uint64(&ints);
  uint64_t rdev = uint32s_to_uint64(&ints);
  uint64_t blksize = uint32s_to_uint64(&ints);
  uint64_t blocks = uint32s_to_uint64(&ints);
  stat->st_size = (off_t) size;
  stat->st_dev = (dev_t) dev;
  stat->st_nlink = (nlink_t) nlink;
  stat->st_ino = (ino_t) ino;
  stat->st_rdev = (dev_t) rdev;
  stat->st_blksize = (blksize_t) blksize;
  stat->st_blocks = (blkcnt_t) blocks;
  if (stat->st_size < 0 || (uint64_t) stat->st_size != size ||
      (uint64_t) stat->st_dev != dev ||
      (uint64_t) stat->st_nlink != nlink ||
      (uint64_t) stat->st_ino != ino ||
      (uint64_t) stat->st_rdev != rdev ||
      stat->st_blksize < 0 || (uint64_t) stat->st_blksize != blksize ||
      stat->st_blocks < 0 || (uint64_t) stat->st_blocks != blocks) {
    return -ERANGE;
  }
#ifdef __APPLE__
  uint32s_to_timespec(&stat->st_atimespec, &ints);
  uint32s_to_timespec(&stat->st_mtimespec, &ints);
  uint32s_to_timespec(&stat->st_ctimespec, &ints);
#else
  uint32s_to_timespec(&stat->st_atim, &ints);
  uint32s_to_timespec(&stat->st_mtim, &ints);
  uint32s_to_timespec(&stat->st_ctim, &ints);
#endif
  return 0;
}

static int populate_statvfs (uint32_t *ints, struct statvfs* statvfs) {
  memset(statvfs, 0, sizeof(*statvfs));
  uint64_t bsize = uint32s_to_uint64(&ints);
  uint64_t frsize = uint32s_to_uint64(&ints);
  uint64_t blocks = uint32s_to_uint64(&ints);
  uint64_t bfree = uint32s_to_uint64(&ints);
  uint64_t bavail = uint32s_to_uint64(&ints);
  uint64_t files = uint32s_to_uint64(&ints);
  uint64_t ffree = uint32s_to_uint64(&ints);
  uint64_t favail = uint32s_to_uint64(&ints);
  uint64_t fsid = uint32s_to_uint64(&ints);
  uint64_t flag = uint32s_to_uint64(&ints);
  uint64_t namemax = uint32s_to_uint64(&ints);
  statvfs->f_bsize = (unsigned long) bsize;
  statvfs->f_frsize = (unsigned long) frsize;
  statvfs->f_blocks = (fsblkcnt_t) blocks;
  statvfs->f_bfree = (fsblkcnt_t) bfree;
  statvfs->f_bavail = (fsblkcnt_t) bavail;
  statvfs->f_files = (fsfilcnt_t) files;
  statvfs->f_ffree = (fsfilcnt_t) ffree;
  statvfs->f_favail = (fsfilcnt_t) favail;
  statvfs->f_fsid = (unsigned long) fsid;
  statvfs->f_flag = (unsigned long) flag;
  statvfs->f_namemax = (unsigned long) namemax;
  if ((uint64_t) statvfs->f_bsize != bsize ||
      (uint64_t) statvfs->f_frsize != frsize ||
      (uint64_t) statvfs->f_blocks != blocks ||
      (uint64_t) statvfs->f_bfree != bfree ||
      (uint64_t) statvfs->f_bavail != bavail ||
      (uint64_t) statvfs->f_files != files ||
      (uint64_t) statvfs->f_ffree != ffree ||
      (uint64_t) statvfs->f_favail != favail ||
      (uint64_t) statvfs->f_fsid != fsid ||
      (uint64_t) statvfs->f_flag != flag ||
      (uint64_t) statvfs->f_namemax != namemax) {
    return -ERANGE;
  }
  return 0;
}

static napi_status create_uint64_value (napi_env env, uint64_t value, napi_value *result) {
  if (value <= 9007199254740991ULL) {
    return napi_create_double(env, (double) value, result);
  }
  return napi_create_bigint_uint64(env, value, result);
}

static int value_to_uint64 (napi_env env, napi_value value, uint64_t *result) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok) return -1;

  if (type == napi_bigint) {
    bool lossless = false;
    if (napi_get_value_bigint_uint64(env, value, result, &lossless) != napi_ok || !lossless) return -1;
    return 0;
  }

  if (type == napi_number) {
    double number;
    if (napi_get_value_double(env, value, &number) != napi_ok) return -1;
    if (!isfinite(number) || number < 0 || number > 9007199254740991.0 || floor(number) != number) return -1;
    *result = (uint64_t) number;
    return 0;
  }

  return -1;
}

static int get_uint32_array (napi_env env, napi_value value, uint32_t **data, size_t *length) {
  bool is_typedarray = false;
  napi_typedarray_type type;
  size_t elements = 0;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  void *raw_data = NULL;

  if (napi_is_typedarray(env, value, &is_typedarray) != napi_ok || !is_typedarray) return -1;
  if (napi_get_typedarray_info(
        env, value, &type, &elements, &raw_data, &arraybuffer, &byte_offset
      ) != napi_ok ||
      type != napi_uint32_array ||
      byte_offset % sizeof(uint32_t) != 0) {
    return -1;
  }

  *data = (uint32_t *) raw_data;
  *length = elements;
  return 0;
}

static napi_status create_owned_buffer (
  napi_env env,
  const void *source,
  size_t length,
  napi_value *result
) {
  void *data = NULL;
  napi_status status = napi_create_buffer(env, length, &data, result);
  if (status == napi_ok && source != NULL && length > 0) memcpy(data, source, length);
  return status;
}

static int copy_owned_buffer (
  napi_env env,
  napi_value value,
  void *destination,
  size_t capacity,
  size_t length
) {
  bool is_buffer = false;
  void *data = NULL;
  size_t buffer_length = 0;
  if (length > capacity || (length > 0 && destination == NULL)) return -ERANGE;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok ||
      !is_buffer ||
      napi_get_buffer_info(env, value, &data, &buffer_length) != napi_ok ||
      buffer_length < length) {
    return -EIO;
  }
  if (length > 0) memcpy(destination, data, length);
  return 0;
}

static int int64_to_off_t (int64_t value, off_t *result) {
  *result = (off_t) value;
  return (int64_t) *result == value ? 0 : -ERANGE;
}

// Methods

FUSE_METHOD(statfs, 1, 1, (const char * path, struct statvfs *statvfs), {
  l->path = path;
  l->statvfs = statvfs;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
}, {
  uint32_t *ints = NULL;
  size_t ints_length = 0;
  if (res == 0 && (get_uint32_array(env, argv[2], &ints, &ints_length) != 0 || ints_length != 22)) {
    res = -EIO;
  } else if (res == 0) {
    res = populate_statvfs(ints, l->statvfs);
  }
})

FUSE_METHOD(getattr, 1, 1, (const char *path, struct stat *stat), {
  l->path = path;
  l->stat = stat;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
}, {
  uint32_t *ints = NULL;
  size_t ints_length = 0;
  if (res == 0 && (get_uint32_array(env, argv[2], &ints, &ints_length) != 0 || ints_length != 23)) {
    res = -EIO;
  } else if (res == 0) {
    res = populate_stat(ints, l->stat);
  }
})

FUSE_METHOD(fgetattr, 2, 1, (const char *path, struct stat *stat, struct fuse_file_info *info), {
  l->path = path;
  l->stat = stat;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 3)
  }
}, {
  uint32_t *ints = NULL;
  size_t ints_length = 0;
  if (res == 0 && (get_uint32_array(env, argv[2], &ints, &ints_length) != 0 || ints_length != 23)) {
    res = -EIO;
  } else if (res == 0) {
    res = populate_stat(ints, l->stat);
  }
})

FUSE_METHOD_VOID(access, 2, 0, (const char *path, int mode), {
  l->path = path;
  l->int_value = mode;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_int32(env, l->int_value, &(argv[3]));
})

#define FUSE_FILE_INFO_DIRECT_IO 1U
#define FUSE_FILE_INFO_KEEP_CACHE 2U
#define FUSE_FILE_INFO_NONSEEKABLE 4U
#define FUSE_FILE_INFO_ALLOWED_FLAGS \
  (FUSE_FILE_INFO_DIRECT_IO | FUSE_FILE_INFO_KEEP_CACHE | FUSE_FILE_INFO_NONSEEKABLE)

#define FUSE_APPLY_FILE_INFO_RESULT()\
  uint64_t fd = 0;\
  uint32_t result_flags = 0;\
  if (res == 0 &&\
      (value_to_uint64(env, argv[2], &fd) != 0 ||\
       napi_get_value_uint32(env, argv[3], &result_flags) != napi_ok ||\
       (result_flags & ~FUSE_FILE_INFO_ALLOWED_FLAGS) != 0)) {\
    res = -EINVAL;\
  }\
  if (res == 0 && l->info != NULL) {\
    l->info->fh = fd;\
    l->info->direct_io = (result_flags & FUSE_FILE_INFO_DIRECT_IO) != 0;\
    l->info->keep_cache = (result_flags & FUSE_FILE_INFO_KEEP_CACHE) != 0;\
    l->info->nonseekable = (result_flags & FUSE_FILE_INFO_NONSEEKABLE) != 0;\
  }

FUSE_METHOD(open, 2, 2, (const char *path, struct fuse_file_info *info), {
  l->path = path;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    napi_create_int32(env, l->info->flags, &(argv[3]));
  } else {
    napi_create_uint32(env, 0, &(argv[3]));
  }
}, {
  FUSE_APPLY_FILE_INFO_RESULT()
})

FUSE_METHOD(opendir, 2, 2, (const char *path, struct fuse_file_info *info), {
  l->path = path;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    napi_create_int32(env, l->info->flags, &(argv[3]));
  } else {
    napi_create_uint32(env, 0, &(argv[3]));
  }
}, {
  FUSE_APPLY_FILE_INFO_RESULT()
})

FUSE_METHOD(create, 3, 2, (const char *path, mode_t mode, struct fuse_file_info *info), {
  l->path = path;
  l->mode = mode;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_uint32(env, l->mode, &(argv[3]));
  if (l->info != NULL) {
    napi_create_int32(env, l->info->flags, &(argv[4]));
  } else {
    napi_create_uint32(env, 0, &(argv[4]));
  }
}, {
  FUSE_APPLY_FILE_INFO_RESULT()
})

FUSE_METHOD_VOID(utimens, 5, 0, (const char *path, const struct timespec tv[2]), {
  l->path = path;
  if (timespec_to_int64(&tv[0], &(l->atime)) != 0 ||
      timespec_to_int64(&tv[1], &(l->mtime)) != 0) {
    return -EOVERFLOW;
  }
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  FUSE_UINT64_TO_INTS_ARGV(l->atime, 3)
  FUSE_UINT64_TO_INTS_ARGV(l->mtime, 5)
})

FUSE_METHOD_VOID(release, 2, 0, (const char *path, struct fuse_file_info *info), {
  l->path = path;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 3)
  }
})

FUSE_METHOD_VOID(releasedir, 2, 0, (const char *path, struct fuse_file_info *info), {
  l->path = path;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 3)
  }
})

FUSE_METHOD(read, 6, 1, (const char *path, char *buf, size_t len, off_t offset, struct fuse_file_info *info), {
  if (len > UINT32_MAX) return -EOVERFLOW;
  l->path = path;
  l->buf = buf;
  l->len = len;
  l->offset = offset;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  FUSE_CREATE_OWNED_BUFFER_ARGV(NULL, l->len, 4)
  napi_create_uint32(env, (uint32_t) l->len, &(argv[5]));
  FUSE_UINT64_TO_INTS_ARGV(l->offset, 6)
}, {
  if (res > 0) {
    if ((size_t) res > l->len) {
      res = -EIO;
    } else {
      int copy_result = copy_owned_buffer(env, argv[2], (void *) l->buf, l->len, (size_t) res);
      if (copy_result != 0) res = copy_result;
    }
  }
})

FUSE_METHOD(write, 6, 0, (const char *path, const char *buf, size_t len, off_t offset, struct fuse_file_info *info), {
  if (len > UINT32_MAX) return -EOVERFLOW;
  l->path = path;
  l->buf = buf;
  l->len = len;
  l->offset = offset;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  FUSE_CREATE_OWNED_BUFFER_ARGV(l->buf, l->len, 4)
  napi_create_uint32(env, (uint32_t) l->len, &(argv[5]));
  FUSE_UINT64_TO_INTS_ARGV(l->offset, 6)
}, {
  if (res > 0 && (size_t) res > l->len) res = -EIO;
})

FUSE_METHOD(readdir, 4, 3, (const char *path, void *buf, fuse_fill_dir_t filler, off_t offset, struct fuse_file_info *info), {
  l->buf = buf;
  l->path = path;
  l->offset = offset;
  l->info = info;
  l->readdir_filler = filler;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 3)
  }
  FUSE_UINT64_TO_INTS_ARGV(l->offset, 4)
}, {
  bool names_is_array = false;
  bool stats_is_array = false;
  uint32_t names_length = 0;
  uint32_t stats_length = 0;
  uint32_t *offsets = NULL;
  size_t offsets_length = 0;

  if (res == 0 &&
      (napi_is_array(env, argv[2], &names_is_array) != napi_ok ||
       napi_is_array(env, argv[3], &stats_is_array) != napi_ok ||
       !names_is_array ||
       !stats_is_array ||
       napi_get_array_length(env, argv[2], &names_length) != napi_ok ||
       napi_get_array_length(env, argv[3], &stats_length) != napi_ok ||
       (stats_length != 0 && stats_length != names_length) ||
       get_uint32_array(env, argv[4], &offsets, &offsets_length) != 0 ||
       (offsets_length != 0 && offsets_length != (size_t) names_length * 2))) {
    res = -EIO;
  }

  for (uint32_t i = 0; res == 0 && i < names_length; i++) {
    napi_value raw_name;
    size_t name_length = 0;
    char name[256];
    if (napi_get_element(env, argv[2], i, &raw_name) != napi_ok ||
        napi_get_value_string_utf8(env, raw_name, NULL, 0, &name_length) != napi_ok ||
        name_length > 255 ||
        napi_get_value_string_utf8(env, raw_name, name, sizeof(name), &name_length) != napi_ok) {
      res = -EIO;
      break;
    }

    struct stat st = {0};
    struct stat *stat_ptr = NULL;
    if (stats_length != 0) {
      napi_value raw_stat;
      uint32_t *stats_array = NULL;
      size_t stats_array_length = 0;
      if (napi_get_element(env, argv[3], i, &raw_stat) != napi_ok ||
          get_uint32_array(env, raw_stat, &stats_array, &stats_array_length) != 0 ||
          stats_array_length != 23) {
        res = -EIO;
        break;
      }
      int stat_result = populate_stat(stats_array, &st);
      if (stat_result != 0) {
        res = stat_result;
        break;
      }
      stat_ptr = &st;
    }

    off_t next_offset = 0;
    if (offsets_length != 0) {
      uint32_t *offset_parts = &(offsets[(size_t) i * 2]);
      int64_t encoded_offset = uint32s_to_int64(&offset_parts);
      if (encoded_offset == 0 || int64_to_off_t(encoded_offset, &next_offset) != 0) {
        res = -EIO;
        break;
      }
    }

    if (l->readdir_filler((char *) l->buf, name, stat_ptr, next_offset) != 0) break;
  }
})

#ifdef __APPLE__

FUSE_METHOD(setxattr, 5, 0, (const char *path, const char *name, const char *value, size_t size, int flags, uint32_t position), {
  l->path = path;
  l->name = name;
  l->value = value;
  l->size = size;
  l->flags = flags;
  l->position = position;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->name, NAPI_AUTO_LENGTH, &(argv[3]));
  FUSE_CREATE_OWNED_BUFFER_ARGV(l->value, l->size, 4)
  napi_create_uint32(env, l->position, &(argv[5]));
  napi_create_int32(env, l->flags, &(argv[6]));
}, {
  if (res > 0) res = -EIO;
})

FUSE_METHOD(getxattr, 4, 1, (const char *path, const char *name, char *value, size_t size, uint32_t position), {
  l->path = path;
  l->name = name;
  l->value = value;
  l->size = size;
  l->position = position;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->name, NAPI_AUTO_LENGTH, &(argv[3]));
  FUSE_CREATE_OWNED_BUFFER_ARGV(NULL, l->size, 4)
  napi_create_uint32(env, l->position, &(argv[5]));
}, {
  if (l->size > 0 && res > 0) {
    if ((size_t) res > l->size) {
      res = -ERANGE;
    } else {
      int copy_result = copy_owned_buffer(env, argv[2], (void *) l->value, l->size, (size_t) res);
      if (copy_result != 0) res = copy_result;
    }
  }
})

#else

FUSE_METHOD(setxattr, 5, 0, (const char *path, const char *name, const char *value, size_t size, int flags), {
  l->path = path;
  l->name = name;
  l->value = value;
  l->size = size;
  l->flags = flags;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->name, NAPI_AUTO_LENGTH, &(argv[3]));
  FUSE_CREATE_OWNED_BUFFER_ARGV(l->value, l->size, 4)
  napi_create_uint32(env, 0, &(argv[5])); // normalize apis between mac and linux
  napi_create_int32(env, l->flags, &(argv[6]));
}, {
  if (res > 0) res = -EIO;
})

FUSE_METHOD(getxattr, 4, 1, (const char *path, const char *name, char *value, size_t size), {
  l->path = path;
  l->name = name;
  l->value = value;
  l->size = size;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->name, NAPI_AUTO_LENGTH, &(argv[3]));
  FUSE_CREATE_OWNED_BUFFER_ARGV(NULL, l->size, 4)
  napi_create_uint32(env, 0, &(argv[5]));
}, {
  if (l->size > 0 && res > 0) {
    if ((size_t) res > l->size) {
      res = -ERANGE;
    } else {
      int copy_result = copy_owned_buffer(env, argv[2], (void *) l->value, l->size, (size_t) res);
      if (copy_result != 0) res = copy_result;
    }
  }
})

#endif

FUSE_METHOD(listxattr, 2, 1, (const char *path, char *list, size_t size), {
  l->path = path;
  l->list = list;
  l->size = size;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  FUSE_CREATE_OWNED_BUFFER_ARGV(NULL, l->size, 3)
}, {
  if (l->size > 0 && res > 0) {
    if ((size_t) res > l->size) {
      res = -ERANGE;
    } else {
      int copy_result = copy_owned_buffer(env, argv[2], l->list, l->size, (size_t) res);
      if (copy_result != 0) res = copy_result;
    }
  }
})

FUSE_METHOD_VOID(removexattr, 2, 0, (const char *path, const char *name), {
  l->path = path;
  l->name = name;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->name, NAPI_AUTO_LENGTH, &(argv[3]));
})

FUSE_METHOD_VOID(flush, 2, 0, (const char *path, struct fuse_file_info *info), {
  l->path = path;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 3)
  }
})

FUSE_METHOD_VOID(fsync, 3, 0, (const char *path, int datasync, struct fuse_file_info *info), {
  l->path = path;
  l->int_value = datasync;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_int32(env, l->int_value, &(argv[3]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 4)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 4)
  }
})

FUSE_METHOD_VOID(fsyncdir, 3, 0, (const char *path, int datasync, struct fuse_file_info *info), {
  l->path = path;
  l->int_value = datasync;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_int32(env, l->int_value, &(argv[3]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 4)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 4)
  }
})


FUSE_METHOD_VOID(truncate, 3, 0, (const char *path, off_t size), {
  l->path = path;
  l->offset = size;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  FUSE_UINT64_TO_INTS_ARGV(l->offset, 3)
})

FUSE_METHOD_VOID(ftruncate, 4, 0, (const char *path, off_t size, struct fuse_file_info *info), {
  l->path = path;
  l->offset = size;
  l->info = info;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  if (l->info != NULL) {
    FUSE_CREATE_UINT64_ARGV(l->info->fh, 3)
  } else {
    FUSE_CREATE_UINT64_ARGV(0, 3)
  }
  FUSE_UINT64_TO_INTS_ARGV(l->offset, 4)
})

FUSE_METHOD(readlink, 1, 1, (const char *path, char *linkname, size_t len), {
  l->path = path;
  l->linkname = linkname;
  l->len = len;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
}, {
  if (res == 0) {
    size_t linkname_length = 0;
    if (l->len == 0 ||
        napi_get_value_string_utf8(
          env, argv[2], l->linkname, l->len, &linkname_length
        ) != napi_ok) {
      res = -EIO;
    }
  }
})

FUSE_METHOD_VOID(chown, 3, 0, (const char *path, uid_t uid, gid_t gid), {
  l->path = path;
  l->uid = uid;
  l->gid = gid;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_uint32(env, l->uid, &(argv[3]));
  napi_create_uint32(env, l->gid, &(argv[4]));
})

FUSE_METHOD_VOID(chmod, 2, 0, (const char *path, mode_t mode), {
  l->path = path;
  l->mode = mode;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_uint32(env, l->mode, &(argv[3]));
})

FUSE_METHOD_VOID(mknod, 3, 0, (const char *path, mode_t mode, dev_t dev), {
  l->path = path;
  l->mode = mode;
  l->dev = dev;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_uint32(env, l->mode, &(argv[3]));
  FUSE_CREATE_UINT64_ARGV(l->dev, 4)
})

FUSE_METHOD_VOID(unlink, 1, 0, (const char *path), {
  l->path = path;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
})

FUSE_METHOD_VOID(rename, 2, 0, (const char *path, const char *dest), {
  l->path = path;
  l->dest = dest;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->dest, NAPI_AUTO_LENGTH, &(argv[3]));
})

FUSE_METHOD_VOID(link, 2, 0, (const char *path, const char *dest), {
  l->path = path;
  l->dest = dest;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->dest, NAPI_AUTO_LENGTH, &(argv[3]));
})

FUSE_METHOD_VOID(symlink, 2, 0, (const char *path, const char *dest), {
  l->path = path;
  l->dest = dest;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_string_utf8(env, l->dest, NAPI_AUTO_LENGTH, &(argv[3]));
})

FUSE_METHOD_VOID(mkdir, 2, 0, (const char *path, mode_t mode), {
  l->path = path;
  l->mode = mode;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
  napi_create_uint32(env, l->mode, &(argv[3]));
})

FUSE_METHOD_VOID(rmdir, 1, 0, (const char *path), {
  l->path = path;
}, {
  napi_create_string_utf8(env, l->path, NAPI_AUTO_LENGTH, &(argv[2]));
})

#define FUSE_INIT_CONFIG_MAX_WRITE 1U
#define FUSE_INIT_CONFIG_MAX_READAHEAD 2U
#define FUSE_INIT_CONFIG_MAX_BACKGROUND 4U
#define FUSE_INIT_CONFIG_CONGESTION_THRESHOLD 8U
#define FUSE_INIT_CONFIG_WANT 16U
#define FUSE_INIT_CONFIG_ALLOWED_MASK \
  (FUSE_INIT_CONFIG_MAX_WRITE | FUSE_INIT_CONFIG_MAX_READAHEAD | \
   FUSE_INIT_CONFIG_MAX_BACKGROUND | FUSE_INIT_CONFIG_CONGESTION_THRESHOLD | \
   FUSE_INIT_CONFIG_WANT)

static void fuse_native_dispatch_init (uv_async_t* handle, fuse_thread_locals_t* l, fuse_thread_t* ft) {
  (void) handle;
  FUSE_NATIVE_CALLBACK(ft->handlers[op_init], {
    napi_value argv[11] = {0};

    if (l->conn == NULL ||
        napi_get_reference_value(env, l->self, &(argv[0])) != napi_ok ||
        napi_create_uint32(env, l->op, &(argv[1])) != napi_ok ||
        napi_create_uint32(env, l->conn->proto_major, &(argv[2])) != napi_ok ||
        napi_create_uint32(env, l->conn->proto_minor, &(argv[3])) != napi_ok ||
        napi_create_uint32(env, l->conn->async_read, &(argv[4])) != napi_ok ||
        napi_create_uint32(env, l->conn->max_write, &(argv[5])) != napi_ok ||
        napi_create_uint32(env, l->conn->max_readahead, &(argv[6])) != napi_ok ||
        napi_create_uint32(env, l->conn->capable, &(argv[7])) != napi_ok ||
        napi_create_uint32(env, l->conn->want, &(argv[8])) != napi_ok ||
        napi_create_uint32(env, l->conn->max_background, &(argv[9])) != napi_ok ||
        napi_create_uint32(env, l->conn->congestion_threshold, &(argv[10])) != napi_ok) {
      napi_close_handle_scope(env, scope);
      fuse_native_complete_local(l, -EIO);
      return;
    }

    FUSE_CALL_CALLBACK(11, argv)
  })
}

NAPI_METHOD(fuse_native_signal_init) {
  NAPI_ARGV(3)
  NAPI_ARGV_BUFFER_CAST(fuse_thread_locals_t *, l, 0);
  NAPI_ARGV_INT32(res, 1);
  uint32_t *config = NULL;
  size_t config_length = 0;

  if (res == 0 &&
      (l->conn == NULL ||
       get_uint32_array(env, argv[2], &config, &config_length) != 0 ||
       config_length != 6 ||
       (config[0] & ~FUSE_INIT_CONFIG_ALLOWED_MASK) != 0)) {
    res = -EINVAL;
  }

  if (res == 0) {
    const uint32_t mask = config[0];
    const uint32_t max_write = (mask & FUSE_INIT_CONFIG_MAX_WRITE) != 0
      ? config[1]
      : l->conn->max_write;
    const uint32_t max_readahead = (mask & FUSE_INIT_CONFIG_MAX_READAHEAD) != 0
      ? config[2]
      : l->conn->max_readahead;
    const uint32_t max_background = (mask & FUSE_INIT_CONFIG_MAX_BACKGROUND) != 0
      ? config[3]
      : l->conn->max_background;
    const uint32_t congestion_threshold = (mask & FUSE_INIT_CONFIG_CONGESTION_THRESHOLD) != 0
      ? config[4]
      : l->conn->congestion_threshold;
    const uint32_t want = (mask & FUSE_INIT_CONFIG_WANT) != 0
      ? config[5]
      : l->conn->want;

    if (((mask & FUSE_INIT_CONFIG_MAX_WRITE) != 0 &&
         (max_write == 0 || max_write > l->conn->max_write)) ||
        ((mask & FUSE_INIT_CONFIG_MAX_READAHEAD) != 0 &&
         max_readahead > l->conn->max_readahead) ||
        ((mask & FUSE_INIT_CONFIG_MAX_BACKGROUND) != 0 &&
         (max_background == 0 || max_background > l->conn->max_background)) ||
        ((mask & FUSE_INIT_CONFIG_CONGESTION_THRESHOLD) != 0 &&
         (congestion_threshold == 0 ||
          congestion_threshold > l->conn->congestion_threshold)) ||
        ((mask & (FUSE_INIT_CONFIG_MAX_BACKGROUND |
                  FUSE_INIT_CONFIG_CONGESTION_THRESHOLD)) != 0 &&
         congestion_threshold > max_background) ||
        ((mask & FUSE_INIT_CONFIG_WANT) != 0 &&
         (want & ~l->conn->capable) != 0)) {
      res = -EINVAL;
    } else {
      if ((mask & FUSE_INIT_CONFIG_MAX_WRITE) != 0) l->conn->max_write = max_write;
      if ((mask & FUSE_INIT_CONFIG_MAX_READAHEAD) != 0) l->conn->max_readahead = max_readahead;
      if ((mask & FUSE_INIT_CONFIG_MAX_BACKGROUND) != 0) l->conn->max_background = max_background;
      if ((mask & FUSE_INIT_CONFIG_CONGESTION_THRESHOLD) != 0) {
        l->conn->congestion_threshold = congestion_threshold;
      }
      if ((mask & FUSE_INIT_CONFIG_WANT) != 0) l->conn->want = want;
    }
  }

  fuse_native_complete_local(l, res);
  return NULL;
}

static void * fuse_native_init (struct fuse_conn_info *conn) {
  fuse_thread_locals_t *l = get_thread_locals();
  fuse_thread_t *ft = (fuse_thread_t *) fuse_get_context()->private_data;
  if (l == NULL) return ft;

  l->op = op_init;
  l->op_fn = fuse_native_dispatch_init;
  l->conn = conn;

  atomic_store(&(l->waiting), 1);
  if (uv_async_send(&(l->async)) < 0) {
    atomic_store(&(l->waiting), 0);
    return ft;
  }
  uv_sem_wait(&(l->sem));
  l->conn = NULL;

  return ft;
}

// Top-level dispatcher

static void fuse_native_dispatch (uv_async_t* handle) {
  fuse_thread_locals_t *l = (fuse_thread_locals_t *) handle->data;
  fuse_thread_t *ft = l->fuse;
  if (atomic_load(&(ft->cleanup_scheduled))) {
    fuse_native_complete_local(l, -EIO);
    return;
  }
  l->op_fn(handle, l, ft);
}

static void fuse_native_async_init (uv_async_t* handle) {
  fuse_thread_t *ft = (fuse_thread_t *) handle->data;
  fuse_thread_locals_t *l = calloc(1, sizeof(*l));
  napi_handle_scope scope;
  if (napi_open_handle_scope(ft->env, &scope) != napi_ok) {
    ft->async_init_status = UV_EIO;
    ft->async.data = NULL;
    free(l);
    uv_sem_post(&(ft->sem));
    return;
  }
  ft->async_init_status = UV_ENOMEM;
  ft->async.data = NULL;
  if (l == NULL) {
    napi_close_handle_scope(ft->env, scope);
    uv_sem_post(&(ft->sem));
    return;
  }

  l->fuse = ft;
  atomic_init(&(l->waiting), 0);

  napi_value buf;
  if (napi_create_external_buffer(ft->env, sizeof(*l), (char *) l, NULL, NULL, &buf) != napi_ok ||
      napi_create_reference(ft->env, buf, 1, &(l->self)) != napi_ok) {
    free(l);
    napi_close_handle_scope(ft->env, scope);
    uv_sem_post(&(ft->sem));
    return;
  }

  int err = uv_sem_init(&(l->sem), 0);
  if (err < 0) {
    napi_delete_reference(ft->env, l->self);
    free(l);
    ft->async_init_status = err;
    napi_close_handle_scope(ft->env, scope);
    uv_sem_post(&(ft->sem));
    return;
  }
  l->sem_initialized = 1;

  err = uv_async_init(ft->loop, &(l->async), (uv_async_cb) fuse_native_dispatch);
  if (err < 0) {
    uv_sem_destroy(&(l->sem));
    napi_delete_reference(ft->env, l->self);
    free(l);
    ft->async_init_status = err;
    napi_close_handle_scope(ft->env, scope);
    uv_sem_post(&(ft->sem));
    return;
  }
  l->async_initialized = 1;
  uv_unref((uv_handle_t *) &(l->async));

  l->async.data = l;
  l->next = ft->locals;
  ft->locals = l;
  ft->async.data = l;
  ft->async_init_status = 0;

  napi_close_handle_scope(ft->env, scope);
  uv_sem_post(&(ft->sem));
}

static fuse_thread_locals_t* get_thread_locals (void) {
  struct fuse_context *ctx = fuse_get_context();
  if (ctx == NULL || ctx->private_data == NULL) return NULL;
  fuse_thread_t *ft = (fuse_thread_t *) ctx->private_data;

  void *data = pthread_getspecific(thread_locals_key);

  if (data != NULL && !atomic_load(&(ft->cleanup_scheduled))) {
    return (fuse_thread_locals_t *) data;
  }
  if (data != NULL) return NULL;

  uv_mutex_lock(&(ft->mut));
  if (atomic_load(&(ft->cleanup_scheduled))) {
    uv_mutex_unlock(&(ft->mut));
    return NULL;
  }
  ft->async.data = ft;
  ft->async_init_status = UV_EIO;

  if (uv_async_send(&(ft->async)) < 0) {
    uv_mutex_unlock(&(ft->mut));
    return NULL;
  }
  uv_sem_wait(&(ft->sem));

  fuse_thread_locals_t *l = ft->async_init_status == 0
    ? (fuse_thread_locals_t*) ft->async.data
    : NULL;

  if (l != NULL) pthread_setspecific(thread_locals_key, (void *) l);
  uv_mutex_unlock(&(ft->mut));

  return l;
}

static void* start_fuse_thread (void *data) {
  fuse_thread_t *ft = (fuse_thread_t *) data;
  fuse_loop_mt(ft->fuse);

  uv_mutex_lock(&(ft->mut));
  struct fuse *fuse = ft->fuse;
  struct fuse_chan *ch = ft->ch;
  ft->fuse = NULL;
  ft->ch = NULL;
  uv_mutex_unlock(&(ft->mut));

  if (ch != NULL) fuse_unmount(ft->mnt, ch);
  if (fuse != NULL && ch != NULL) fuse_session_remove_chan(ch);
  if (fuse != NULL) fuse_destroy(fuse);

  return NULL;
}

static void fuse_native_delete_references (fuse_thread_t *ft) {
  if (ft->ctx != NULL) {
    napi_delete_reference(ft->env, ft->ctx);
    ft->ctx = NULL;
  }
  for (size_t i = 0; i < FUSE_OPERATION_COUNT; i++) {
    if (ft->handlers[i] != NULL) {
      napi_delete_reference(ft->env, ft->handlers[i]);
      ft->handlers[i] = NULL;
    }
  }
}

static void fuse_native_free_strings (fuse_thread_t *ft) {
  free(ft->mnt);
  free(ft->mntopts);
  ft->mnt = NULL;
  ft->mntopts = NULL;
}

static void fuse_native_failed_async_closed (uv_handle_t *handle) {
  fuse_thread_t *ft = (fuse_thread_t *) handle->data;
  if (ft->state_ref != NULL) {
    napi_delete_reference(ft->env, ft->state_ref);
    ft->state_ref = NULL;
  }
}

static void fuse_native_mount_cleanup (fuse_thread_t *ft) {
  if (ft->fuse != NULL || ft->ch != NULL) {
    if (ft->ch != NULL) fuse_unmount(ft->mnt, ft->ch);
    if (ft->fuse != NULL && ft->ch != NULL) fuse_session_remove_chan(ft->ch);
    if (ft->fuse != NULL) fuse_destroy(ft->fuse);
    ft->fuse = NULL;
    ft->ch = NULL;
  }
  if (ft->async_initialized) {
    ft->async.data = ft;
    uv_close((uv_handle_t *) &(ft->async), fuse_native_failed_async_closed);
    ft->async_initialized = 0;
  } else if (ft->state_ref != NULL) {
    napi_delete_reference(ft->env, ft->state_ref);
    ft->state_ref = NULL;
  }
  if (ft->sem_initialized) {
    uv_sem_destroy(&(ft->sem));
    ft->sem_initialized = 0;
  }
  if (ft->mutex_initialized) {
    uv_mutex_destroy(&(ft->mut));
    ft->mutex_initialized = 0;
  }
  if (ft->attr_initialized) {
    pthread_attr_destroy(&(ft->attr));
    ft->attr_initialized = 0;
  }
  if (ft->cleanup_hook != NULL) {
    napi_remove_async_cleanup_hook(ft->cleanup_hook);
    ft->cleanup_hook = NULL;
  }
  fuse_native_delete_references(ft);
  fuse_native_free_strings(ft);
}

static char * fuse_native_string (napi_env env, napi_value value) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &size) != napi_ok) return NULL;
  char *string = malloc(size + 1);
  if (string == NULL) return NULL;
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, string, size + 1, &written) != napi_ok) {
    free(string);
    return NULL;
  }
  string[written] = '\0';
  return string;
}

static void fuse_native_finish_cleanup (fuse_thread_t *ft);

static void fuse_native_local_closed (uv_handle_t *handle) {
  fuse_thread_locals_t *l = (fuse_thread_locals_t *) handle->data;
  fuse_thread_t *ft = l->fuse;
  free(l);
  if (--ft->close_pending == 0) fuse_native_finish_cleanup(ft);
}

static void fuse_native_thread_async_closed (uv_handle_t *handle) {
  fuse_thread_t *ft = (fuse_thread_t *) handle->data;
  if (--ft->close_pending == 0) fuse_native_finish_cleanup(ft);
}

static void fuse_native_finish_cleanup (fuse_thread_t *ft) {
  ft->mounted = 0;
  ft->thread_started = 0;
  ft->locals = NULL;
  fuse_native_free_strings(ft);

  if (ft->cleanup_hook != NULL) {
    napi_remove_async_cleanup_hook(ft->cleanup_hook);
    ft->cleanup_hook = NULL;
  }

  if (ft->env_cleanup) {
    if (ft->cleanup_cb != NULL) {
      napi_delete_reference(ft->env, ft->cleanup_cb);
      ft->cleanup_cb = NULL;
    }
    if (ft->state_ref != NULL) {
      napi_delete_reference(ft->env, ft->state_ref);
      ft->state_ref = NULL;
    }
    return;
  }

  napi_handle_scope scope;
  if (napi_open_handle_scope(ft->env, &scope) != napi_ok) {
    if (ft->cleanup_cb != NULL) {
      napi_delete_reference(ft->env, ft->cleanup_cb);
      ft->cleanup_cb = NULL;
    }
    if (ft->state_ref != NULL) {
      napi_delete_reference(ft->env, ft->state_ref);
      ft->state_ref = NULL;
    }
    return;
  }
  napi_value callback;
  napi_value global;
  napi_value argv[1];
  napi_get_global(ft->env, &global);
  napi_get_reference_value(ft->env, ft->cleanup_cb, &callback);

  if (ft->cleanup_error == 0) {
    napi_get_null(ft->env, &(argv[0]));
  } else {
    napi_value message;
    char text[128];
    snprintf(text, sizeof(text), "Native FUSE cleanup failed: %s", strerror(ft->cleanup_error));
    napi_create_string_utf8(ft->env, text, NAPI_AUTO_LENGTH, &message);
    napi_create_error(ft->env, NULL, message, &(argv[0]));
  }

  napi_delete_reference(ft->env, ft->cleanup_cb);
  ft->cleanup_cb = NULL;
  napi_status call_status = napi_call_function(ft->env, global, callback, 1, argv, NULL);
  if (call_status == napi_pending_exception) {
    napi_value exception;
    napi_get_and_clear_last_exception(ft->env, &exception);
    napi_fatal_exception(ft->env, exception);
  }
  napi_close_handle_scope(ft->env, scope);
  if (ft->state_ref != NULL) {
    napi_delete_reference(ft->env, ft->state_ref);
    ft->state_ref = NULL;
  }
}

static void fuse_native_cleanup_work (uv_work_t *request) {
  fuse_thread_t *ft = (fuse_thread_t *) request->data;
  if (ft->thread_started) {
    int err = pthread_join(ft->thread, NULL);
    if (err != 0) ft->cleanup_error = err;
  }

  for (fuse_thread_locals_t *l = ft->locals; l != NULL; l = l->next) {
    if (l->sem_initialized) {
      uv_sem_destroy(&(l->sem));
      l->sem_initialized = 0;
    }
  }
  if (ft->sem_initialized) {
    uv_sem_destroy(&(ft->sem));
    ft->sem_initialized = 0;
  }
  if (ft->attr_initialized) {
    int err = pthread_attr_destroy(&(ft->attr));
    if (err != 0 && ft->cleanup_error == 0) ft->cleanup_error = err;
    ft->attr_initialized = 0;
  }
  if (ft->mutex_initialized) {
    uv_mutex_destroy(&(ft->mut));
    ft->mutex_initialized = 0;
  }
}

static void fuse_native_cleanup_after (uv_work_t *request, int status) {
  fuse_thread_t *ft = (fuse_thread_t *) request->data;
  if (status < 0 && ft->cleanup_error == 0) ft->cleanup_error = EIO;

  fuse_native_delete_references(ft);
  ft->close_pending = 0;

  for (fuse_thread_locals_t *l = ft->locals; l != NULL; l = l->next) {
    if (l->self != NULL) {
      napi_delete_reference(ft->env, l->self);
      l->self = NULL;
    }
    if (l->async_initialized) ft->close_pending++;
  }
  if (ft->async_initialized) ft->close_pending++;

  for (fuse_thread_locals_t *l = ft->locals; l != NULL; l = l->next) {
    if (l->async_initialized) {
      l->async_initialized = 0;
      uv_close((uv_handle_t *) &(l->async), fuse_native_local_closed);
    }
  }
  if (ft->async_initialized) {
    ft->async_initialized = 0;
    ft->async.data = ft;
    uv_close((uv_handle_t *) &(ft->async), fuse_native_thread_async_closed);
  }

  if (ft->close_pending == 0) fuse_native_finish_cleanup(ft);
}

static int fuse_native_begin_cleanup (fuse_thread_t *ft, int env_cleanup) {
  int expected = 0;
  if (!atomic_compare_exchange_strong(&(ft->cleanup_scheduled), &expected, 1)) return UV_EALREADY;
  ft->env_cleanup = env_cleanup;
  ft->cleanup_error = 0;

  if (ft->mutex_initialized) {
    uv_mutex_lock(&(ft->mut));
    if (ft->fuse != NULL) fuse_exit(ft->fuse);
    uv_mutex_unlock(&(ft->mut));
  }

  for (fuse_thread_locals_t *l = ft->locals; l != NULL; l = l->next) {
    fuse_native_complete_local(l, -EIO);
  }

  ft->cleanup_work.data = ft;
  int err = uv_queue_work(ft->loop, &(ft->cleanup_work), fuse_native_cleanup_work, fuse_native_cleanup_after);
  if (err < 0) {
    fuse_native_cleanup_work(&(ft->cleanup_work));
    fuse_native_cleanup_after(&(ft->cleanup_work), 0);
    return 0;
  }
  return 0;
}

static void fuse_native_env_cleanup (napi_async_cleanup_hook_handle handle, void *data) {
  (void) handle;
  fuse_thread_t *ft = (fuse_thread_t *) data;
  if (atomic_load(&(ft->cleanup_scheduled))) {
    ft->env_cleanup = 1;
    return;
  }
  fuse_native_begin_cleanup(ft, 1);
}

NAPI_METHOD(fuse_native_mount) {
  NAPI_ARGV(6)

  NAPI_ARGV_BUFFER_CAST(fuse_thread_t *, ft, 2);
  if (ft_len < sizeof(*ft)) {
    napi_throw_range_error(env, "EINVAL", "Invalid native thread state buffer");
    return NULL;
  }
  memset(ft, 0, sizeof(*ft));
  atomic_init(&(ft->cleanup_scheduled), 0);
  ft->env = env;
  if (napi_create_reference(env, argv[2], 1, &(ft->state_ref)) != napi_ok) {
    napi_throw_error(env, "EFUSEINIT", "Failed to retain the native thread state");
    return NULL;
  }

  ft->mnt = fuse_native_string(env, argv[0]);
  ft->mntopts = fuse_native_string(env, argv[1]);
  if (ft->mnt == NULL || ft->mntopts == NULL) {
    fuse_native_mount_cleanup(ft);
    napi_throw_type_error(env, "EINVAL", "Mountpoint and mount options must be strings");
    return NULL;
  }

  if (napi_get_uv_event_loop(env, &(ft->loop)) != napi_ok ||
      napi_create_reference(env, argv[3], 1, &(ft->ctx)) != napi_ok) {
    fuse_native_mount_cleanup(ft);
    napi_throw_error(env, "EFUSEINIT", "Failed to initialize the native Node.js context");
    return NULL;
  }

  napi_value handlers = argv[4];
  uint32_t *implemented = NULL;
  size_t implemented_len = 0;
  if (get_uint32_array(env, argv[5], &implemented, &implemented_len) != 0 ||
      implemented_len != FUSE_OPERATION_COUNT) {
    fuse_native_mount_cleanup(ft);
    napi_throw_range_error(env, "EINVAL", "Invalid implemented-operation buffer");
    return NULL;
  }

  bool handlers_is_array = false;
  uint32_t handlers_length = 0;
  if (napi_is_array(env, handlers, &handlers_is_array) != napi_ok ||
      !handlers_is_array ||
      napi_get_array_length(env, handlers, &handlers_length) != napi_ok ||
      handlers_length != FUSE_OPERATION_COUNT) {
    fuse_native_mount_cleanup(ft);
    napi_throw_type_error(env, "EINVAL", "Unexpected FUSE operation-handler count");
    return NULL;
  }

  for (uint32_t i = 0; i < handlers_length; i++) {
    napi_value handler;
    napi_valuetype type;
    if (napi_get_element(env, handlers, i, &handler) != napi_ok ||
        napi_typeof(env, handler, &type) != napi_ok) {
      fuse_native_mount_cleanup(ft);
      napi_throw_type_error(env, "EINVAL", "Invalid FUSE operation handler");
      return NULL;
    }
    if (type == napi_function) {
      if (napi_create_reference(env, handler, 1, &ft->handlers[i]) == napi_ok) continue;
      fuse_native_mount_cleanup(ft);
      napi_throw_error(env, "EFUSEINIT", "Failed to retain a FUSE operation handler");
      return NULL;
    }
    if (implemented[i]) {
      fuse_native_mount_cleanup(ft);
      napi_throw_type_error(env, "EINVAL", "An implemented FUSE operation has no handler");
      return NULL;
    }
  }

  struct fuse_operations ops = {0};
  if (implemented[op_access]) ops.access = fuse_native_access;
  if (implemented[op_truncate]) ops.truncate = fuse_native_truncate;
  if (implemented[op_ftruncate]) ops.ftruncate = fuse_native_ftruncate;
  if (implemented[op_getattr]) ops.getattr = fuse_native_getattr;
  if (implemented[op_fgetattr]) ops.fgetattr = fuse_native_fgetattr;
  if (implemented[op_flush]) ops.flush = fuse_native_flush;
  if (implemented[op_fsync]) ops.fsync = fuse_native_fsync;
  if (implemented[op_fsyncdir]) ops.fsyncdir = fuse_native_fsyncdir;
  if (implemented[op_readdir]) ops.readdir = fuse_native_readdir;
  if (implemented[op_readlink]) ops.readlink = fuse_native_readlink;
  if (implemented[op_chown]) ops.chown = fuse_native_chown;
  if (implemented[op_chmod]) ops.chmod = fuse_native_chmod;
  if (implemented[op_mknod]) ops.mknod = fuse_native_mknod;
  if (implemented[op_setxattr]) ops.setxattr = fuse_native_setxattr;
  if (implemented[op_getxattr]) ops.getxattr = fuse_native_getxattr;
  if (implemented[op_listxattr]) ops.listxattr = fuse_native_listxattr;
  if (implemented[op_removexattr]) ops.removexattr = fuse_native_removexattr;
  if (implemented[op_statfs]) ops.statfs = fuse_native_statfs;
  if (implemented[op_open]) ops.open = fuse_native_open;
  if (implemented[op_opendir]) ops.opendir = fuse_native_opendir;
  if (implemented[op_read]) ops.read = fuse_native_read;
  if (implemented[op_write]) ops.write = fuse_native_write;
  if (implemented[op_release]) ops.release = fuse_native_release;
  if (implemented[op_releasedir]) ops.releasedir = fuse_native_releasedir;
  if (implemented[op_create]) ops.create = fuse_native_create;
  if (implemented[op_utimens]) ops.utimens = fuse_native_utimens;
  if (implemented[op_unlink]) ops.unlink = fuse_native_unlink;
  if (implemented[op_rename]) ops.rename = fuse_native_rename;
  if (implemented[op_link]) ops.link = fuse_native_link;
  if (implemented[op_symlink]) ops.symlink = fuse_native_symlink;
  if (implemented[op_mkdir]) ops.mkdir = fuse_native_mkdir;
  if (implemented[op_rmdir]) ops.rmdir = fuse_native_rmdir;
  if (implemented[op_init]) ops.init = fuse_native_init;

  int _argc = ft->mntopts[0] == '\0' ? 1 : 2;
  char *_argv[] = {
    (char *) "fuse_bindings_dummy",
    ft->mntopts
  };

  struct fuse_args args = FUSE_ARGS_INIT(_argc, _argv);
  ft->ch = fuse_mount(ft->mnt, &args);
  if (ft->ch == NULL) {
    fuse_opt_free_args(&args);
    fuse_native_mount_cleanup(ft);
    napi_throw_error(env, "EFUSEMOUNT", "libfuse failed to mount the requested mountpoint");
    return NULL;
  }

  ft->fuse = fuse_new(ft->ch, &args, &ops, sizeof(ops), ft);
  fuse_opt_free_args(&args);
  if (ft->fuse == NULL) {
    fuse_native_mount_cleanup(ft);
    napi_throw_error(env, "EFUSEINIT", "libfuse failed to initialize the mounted filesystem");
    return NULL;
  }

  int err = uv_mutex_init(&(ft->mut));
  if (err < 0) goto mount_failed;
  ft->mutex_initialized = 1;

  err = uv_sem_init(&(ft->sem), 0);
  if (err < 0) goto mount_failed;
  ft->sem_initialized = 1;

  err = uv_async_init(ft->loop, &(ft->async), (uv_async_cb) fuse_native_async_init);
  if (err < 0) goto mount_failed;
  ft->async_initialized = 1;
  ft->async.data = ft;
  uv_unref((uv_handle_t *) &(ft->async));

  err = pthread_attr_init(&(ft->attr));
  if (err != 0) goto mount_failed;
  ft->attr_initialized = 1;

  if (napi_add_async_cleanup_hook(env, fuse_native_env_cleanup, ft, &(ft->cleanup_hook)) != napi_ok) {
    err = UV_EINVAL;
    goto mount_failed;
  }

  err = pthread_create(&(ft->thread), &(ft->attr), start_fuse_thread, ft);
  if (err != 0) goto mount_failed;
  ft->thread_started = 1;
  ft->mounted = 1;

  return NULL;

mount_failed:
  fuse_native_mount_cleanup(ft);
  napi_throw_error(env, "EFUSEINIT", err < 0 ? uv_strerror(err) : strerror(err));
  return NULL;
}

NAPI_METHOD(fuse_native_unmount) {
  NAPI_ARGV(2)
  NAPI_ARGV_BUFFER_CAST(fuse_thread_t *, ft, 0);
  if (ft_len < sizeof(*ft) || !ft->mounted) {
    napi_throw_error(env, "EINVAL", "FUSE filesystem is not mounted");
    return NULL;
  }

  if (napi_create_reference(env, argv[1], 1, &(ft->cleanup_cb)) != napi_ok) {
    napi_throw_error(env, "EFUSECLEANUP", "Failed to retain the unmount callback");
    return NULL;
  }

  int err = fuse_native_begin_cleanup(ft, 0);
  if (err < 0) {
    napi_delete_reference(env, ft->cleanup_cb);
    ft->cleanup_cb = NULL;
    atomic_store(&(ft->cleanup_scheduled), 0);
    napi_throw_error(env, "EFUSECLEANUP", uv_strerror(err));
    return NULL;
  }

  return NULL;
}

NAPI_INIT() {
  if (pthread_once(&(thread_locals_once), create_thread_locals_key) != 0 ||
      thread_locals_status != 0) {
    napi_throw_error(env, "EFUSEINIT", "Failed to create FUSE thread-local storage");
    return;
  }

  NAPI_EXPORT_SIZEOF(fuse_thread_t)

  NAPI_EXPORT_FUNCTION(fuse_native_mount)
  NAPI_EXPORT_FUNCTION(fuse_native_unmount)

  NAPI_EXPORT_FUNCTION(fuse_native_signal_init)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_access)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_statfs)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_fgetattr)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_getattr)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_flush)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_fsync)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_fsyncdir)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_readdir)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_truncate)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_ftruncate)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_utimens)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_readlink)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_chown)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_chmod)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_mknod)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_setxattr)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_getxattr)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_listxattr)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_removexattr)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_open)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_opendir)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_read)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_write)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_release)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_releasedir)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_create)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_unlink)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_rename)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_link)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_symlink)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_mkdir)
  NAPI_EXPORT_FUNCTION(fuse_native_signal_rmdir)

  NAPI_EXPORT_UINT32(op_init)
  NAPI_EXPORT_UINT32(op_error)
  NAPI_EXPORT_UINT32(op_access)
  NAPI_EXPORT_UINT32(op_statfs)
  NAPI_EXPORT_UINT32(op_fgetattr)
  NAPI_EXPORT_UINT32(op_getattr)
  NAPI_EXPORT_UINT32(op_flush)
  NAPI_EXPORT_UINT32(op_fsync)
  NAPI_EXPORT_UINT32(op_fsyncdir)
  NAPI_EXPORT_UINT32(op_readdir)
  NAPI_EXPORT_UINT32(op_truncate)
  NAPI_EXPORT_UINT32(op_ftruncate)
  NAPI_EXPORT_UINT32(op_utimens)
  NAPI_EXPORT_UINT32(op_readlink)
  NAPI_EXPORT_UINT32(op_chown)
  NAPI_EXPORT_UINT32(op_chmod)
  NAPI_EXPORT_UINT32(op_mknod)
  NAPI_EXPORT_UINT32(op_setxattr)
  NAPI_EXPORT_UINT32(op_getxattr)
  NAPI_EXPORT_UINT32(op_listxattr)
  NAPI_EXPORT_UINT32(op_removexattr)
  NAPI_EXPORT_UINT32(op_open)
  NAPI_EXPORT_UINT32(op_opendir)
  NAPI_EXPORT_UINT32(op_read)
  NAPI_EXPORT_UINT32(op_write)
  NAPI_EXPORT_UINT32(op_release)
  NAPI_EXPORT_UINT32(op_releasedir)
  NAPI_EXPORT_UINT32(op_create)
  NAPI_EXPORT_UINT32(op_unlink)
  NAPI_EXPORT_UINT32(op_rename)
  NAPI_EXPORT_UINT32(op_link)
  NAPI_EXPORT_UINT32(op_symlink)
  NAPI_EXPORT_UINT32(op_mkdir)
  NAPI_EXPORT_UINT32(op_rmdir)
}
