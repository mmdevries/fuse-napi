const fs = require('fs')
const path = require('path')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const memoryFS = require('./fixtures/memory-fs')

tape('first milestone in-memory filesystem', function (t) {
  const mnt = createMountpoint()
  const fuse = new Fuse(mnt, memoryFS(), { force: true })
  const directory = path.join(mnt, 'docs')
  const original = path.join(directory, 'hello.txt')
  const renamed = path.join(directory, 'renamed.txt')
  let mounted = false

  run()

  async function run () {
    try {
      await mount(fuse)
      mounted = true
      t.pass('mounted')

      await fs.promises.mkdir(directory)
      t.pass('mkdir')
      t.same(withoutAppleDouble(await fs.promises.readdir(mnt)), ['docs'], 'readdir')

      const handle = await fs.promises.open(original, 'w+')
      const content = Buffer.from('hello from fuse-napi')
      const written = await handle.write(content, 0, content.length, 0)
      t.equal(written.bytesWritten, content.length, 'create and write')

      const buffer = Buffer.alloc(content.length)
      const read = await handle.read(buffer, 0, buffer.length, 0)
      t.equal(read.bytesRead, content.length, 'read')
      t.same(buffer, content, 'read data matches')
      await handle.close()

      await fs.promises.rename(original, renamed)
      t.same(withoutAppleDouble(await fs.promises.readdir(directory)), ['renamed.txt'], 'rename')

      await fs.promises.unlink(renamed)
      t.same(withoutAppleDouble(await fs.promises.readdir(directory)), [], 'unlink')
    } catch (err) {
      t.fail(err.stack || err.message)
    } finally {
      if (mounted) {
        try {
          await unmount(fuse)
          t.pass('unmounted')
        } catch (err) {
          t.fail(err.stack || err.message)
        }
      }

      fs.rmdir(mnt, function () {
        t.end()
      })
    }
  }
})

function mount (fuse) {
  return new Promise((resolve, reject) => {
    fuse.mount(err => err ? reject(err) : resolve())
  })
}

function unmount (fuse) {
  return new Promise((resolve, reject) => {
    fuse.unmount(err => err ? reject(err) : resolve())
  })
}

function withoutAppleDouble (entries) {
  return entries.filter(entry => !entry.startsWith('._'))
}
