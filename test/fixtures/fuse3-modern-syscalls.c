#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/stat.h>
#include <unistd.h>

static int make_path(char *output, size_t capacity, const char *root, const char *name) {
  int written = snprintf(output, capacity, "%s/%s", root, name);
  if (written < 0 || (size_t) written >= capacity) {
    errno = ENAMETOOLONG;
    return -1;
  }
  return 0;
}

static int fail(const char *operation) {
  fprintf(stderr, "%s failed: %s\n", operation, strerror(errno));
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s MOUNTPOINT\n", argv[0]);
    return 2;
  }

  char source[4096];
  char destination[4096];
  char renamed[4096];
  if (make_path(source, sizeof(source), argv[1], "source") != 0 ||
      make_path(destination, sizeof(destination), argv[1], "destination") != 0 ||
      make_path(renamed, sizeof(renamed), argv[1], "renamed") != 0) {
    return fail("construct path");
  }

  int source_fd = open(source, O_RDONLY | O_CLOEXEC);
  if (source_fd < 0) return fail("open source");
  int destination_fd = open(destination, O_WRONLY | O_CLOEXEC);
  if (destination_fd < 0) return fail("open destination");

  struct statx attributes;
  if (statx(AT_FDCWD, source, 0, STATX_BASIC_STATS, &attributes) != 0)
    return fail("statx");
  if (attributes.stx_size != 32) {
    errno = EIO;
    return fail("statx size");
  }

  ssize_t copied = copy_file_range(source_fd, NULL, destination_fd, NULL, 5, 0);
  if (copied != 5) {
    if (copied >= 0) errno = EIO;
    return fail("copy_file_range");
  }

  off_t data = lseek(source_fd, 0, SEEK_DATA);
  if (data != 7) {
    if (data >= 0) errno = EIO;
    return fail("lseek SEEK_DATA");
  }

  struct pollfd descriptor = {
    .fd = source_fd,
    .events = POLLIN,
    .revents = 0
  };
  int ready = poll(&descriptor, 1, 2000);
  if (ready != 1 || (descriptor.revents & POLLIN) == 0) {
    if (ready >= 0) errno = ETIMEDOUT;
    return fail("poll");
  }

  if (close(destination_fd) != 0 || close(source_fd) != 0) {
    return fail("close");
  }

  if (syscall(
        SYS_renameat2,
        AT_FDCWD,
        source,
        AT_FDCWD,
        renamed,
        RENAME_NOREPLACE
      ) != 0) {
    return fail("renameat2");
  }

  return 0;
}
