const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function evaluateQrCode(wx) {
  const source = fs.readFileSync(path.join(process.cwd(), 'utils/qrcode.js'), 'utf8')
    .replace(/export async function /g, 'async function ')
  return new Function('wx', `${source}\nreturn { getQrCode }`)(wx)
}

async function run() {
  const writes = []
  const wx = {
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager() {
      return {
        writeFile(options) {
          writes.push(options)
          options.success()
        }
      }
    },
    cloud: {
      async callFunction(options) {
        assert.deepEqual(options.data, { action: 'getQrCode', id: 'archive01' })
        return {
          result: {
            ok: true,
            data: {
              file_id: 'cloud://test/codes/archive01.jpg',
              file_base64: '/9j/4A==',
              mime_type: 'image/jpeg'
            }
          }
        }
      }
    }
  }

  const qr = await evaluateQrCode(wx).getQrCode('archive01')
  assert.equal(qr.ready, true)
  assert.equal(qr.path, '/user/archive-code-archive01.jpg')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].data, '/9j/4A==')
  assert.equal(writes[0].encoding, 'base64')
  console.log('passed: qr-code cloud payload is written to a reusable local image')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
