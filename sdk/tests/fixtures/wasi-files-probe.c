// Guest program for sdk/tests/test-wasi-files.mjs. It exercises the WASI file
// surface that sdk/fx-sdk.js implements on top of a host `fs` adapter and
// prints one `name=value` line per check so the host can assert on stdout.
#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static void report(const char *name, const char *value) {
  printf("%s=%s\n", name, value);
}

static void report_errno(const char *name) {
  printf("%s=errno:%d\n", name, errno);
}

int main(void) {
  char buffer[256];

  FILE *seeded = fopen("/home/user/.fx/settings.json", "r");
  if (!seeded) { report_errno("read-seeded"); } else {
    size_t read = fread(buffer, 1, sizeof(buffer) - 1, seeded);
    buffer[read] = '\0';
    fclose(seeded);
    report("read-seeded", buffer);
  }

  FILE *created = fopen("/home/user/project/notes.txt", "w");
  if (!created) { report_errno("create"); } else {
    fputs("first line\n", created);
    fclose(created);
    report("create", "ok");
  }

  FILE *appended = fopen("/home/user/project/notes.txt", "a");
  if (!appended) { report_errno("append"); } else {
    fputs("second line\n", appended);
    fclose(appended);
    report("append", "ok");
  }

  FILE *reopened = fopen("/home/user/project/notes.txt", "r");
  if (!reopened) { report_errno("reread"); } else {
    size_t read = fread(buffer, 1, sizeof(buffer) - 1, reopened);
    buffer[read] = '\0';
    fclose(reopened);
    for (char *cursor = buffer; *cursor; cursor++) if (*cursor == '\n') *cursor = '|';
    report("reread", buffer);
  }

  struct stat info;
  if (stat("/home/user/project/notes.txt", &info) != 0) { report_errno("stat"); } else {
    snprintf(buffer, sizeof(buffer), "%d/%d", (int)info.st_size, S_ISREG(info.st_mode) ? 1 : 0);
    report("stat", buffer);
  }

  if (stat("/home/user/project", &info) != 0) { report_errno("stat-dir"); } else {
    report("stat-dir", S_ISDIR(info.st_mode) ? "dir" : "not-dir");
  }

  if (mkdir("/home/user/project/sub", 0755) != 0) { report_errno("mkdir"); } else {
    report("mkdir", "ok");
  }

  DIR *dir = opendir("/home/user/project");
  if (!dir) { report_errno("readdir"); } else {
    buffer[0] = '\0';
    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
      if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
      if (buffer[0]) strncat(buffer, ",", sizeof(buffer) - strlen(buffer) - 1);
      strncat(buffer, entry->d_name, sizeof(buffer) - strlen(buffer) - 1);
    }
    closedir(dir);
    report("readdir", buffer);
  }

  if (rename("/home/user/project/notes.txt", "/home/user/project/renamed.txt") != 0) {
    report_errno("rename");
  } else {
    report("rename", access("/home/user/project/renamed.txt", F_OK) == 0 ? "ok" : "missing");
  }

  if (unlink("/home/user/project/renamed.txt") != 0) { report_errno("unlink"); } else {
    report("unlink", access("/home/user/project/renamed.txt", F_OK) == 0 ? "still-there" : "ok");
  }

  if (rmdir("/home/user/project/sub") != 0) { report_errno("rmdir"); } else {
    report("rmdir", "ok");
  }

  FILE *missing = fopen("/home/user/project/absent.txt", "r");
  if (missing) { fclose(missing); report("missing", "unexpectedly-open"); } else {
    report_errno("missing");
  }

  return 0;
}
