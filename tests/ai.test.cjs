const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function evaluateAi(wx) {
  const source = fs.readFileSync(path.join(process.cwd(), 'utils/ai.js'), 'utf8')
    .replace(/export async function /g, 'async function ')
  return new Function('wx', `${source}\nreturn { sendTeaAiMessage }`)(wx)
}

async function run() {
  const calls = []
  const wx = {
    cloud: {
      async callFunction(options) {
        calls.push(options)
        return {
          result: {
            ok: true,
            data: { answer: '白牡丹的档案重点描述了花香和清甜滋味。' }
          }
        }
      }
    }
  }
  const messages = [{ role: 'user', content: '请总结这份档案' }]
  const result = await evaluateAi(wx).sendTeaAiMessage(['archive01'], messages)
  assert.equal(result.answer, '白牡丹的档案重点描述了花香和清甜滋味。')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'teaAi')
  assert.deepEqual(calls[0].data, {
    action: 'chat',
    archiveIds: ['archive01'],
    messages
  })
  console.log('passed: tea AI client calls the isolated teaAi cloud function')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
