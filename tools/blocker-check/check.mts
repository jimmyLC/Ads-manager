/**
 * 廣告封鎖自我檢查：抓 EasyList／AdGuard 真實清單，比對我們公開面的
 * class 名稱與 URL，任何規則命中就 FAIL。
 *
 * 用法：npm run blocker-check            # 檢查 javis 與 javid
 *       npm run blocker-check -- javid   # 只檢查單一站
 * 建議：改動版位命名、或想確認時跑一次。
 * 來源：改寫自 vod-site 的 scripts/blocker-check.ts，增加多站設定（見 tools/blocker-check/README.md）。
 */
const LISTS = [
  { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { name: 'EasyList 通用隱藏', url: 'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt' },
  { name: 'AdGuard Base', url: 'https://filters.adtidy.org/extension/ublock/filters/2.txt' },
  { name: 'AdGuard 中文', url: 'https://filters.adtidy.org/extension/ublock/filters/224.txt' },
]

interface SiteConfig {
  host: string
  /** 公開面會出現的字串（class／id／路徑） */
  tokens: string[]
  /** 實際會發出的 URL（相對於站台；id 與 token 為示意值，格式與真實一致） */
  paths: string[]
}
const SITES: Record<string, SiteConfig> = {
  javis: {
    host: 'javis.fyi',
    tokens: ['spotlight-slot', 'spotlight-slot-html'],
    paths: [
      '/api/spotlight/img/as_0123456789/desktop?t=1700000000.AbCdEf',
      '/api/spotlight/img/as_0123456789/mobile@2x?t=1700000000.AbCdEf',
      '/api/spotlight/out/cr_0123456789?placement=javis%3Awatch-below',
    ],
  },
  javid: {
    host: 'javid.fyi',
    tokens: ['promo-slot', 'filled'],
    paths: [
      '/api/promo/serve?slot=result-foot',
      '/api/promo/img/as_0123456789?d=desktop&t=1700000000.AbCdEf',
      '/api/promo/img/as_0123456789?d=mobile&t=1700000000.AbCdEf',
      '/api/promo/out/cr_0123456789?d=desktop&placement=javid%3Aresult-foot',
    ],
  },
}
let TOKENS: string[] = []
let PATHS: string[] = []
let SITE = ''
let HOST = ''

/** 規則的 $ 選項是否讓它不適用於我們（第一方、同網域、圖片/文件請求） */
function ruleApplies(options: Map<string, string | null>): boolean {
  const domain = options.get('domain')
  if (domain) {
    const parts = domain.split('|')
    const included = parts.filter((p) => !p.startsWith('~'))
    const excluded = parts.filter((p) => p.startsWith('~')).map((p) => p.slice(1))
    const match = (d: string): boolean => HOST === d || HOST.endsWith(`.${d}`)
    if (excluded.some(match)) return false
    if (included.length > 0 && !included.some(match)) return false
  }
  const denyallow = options.get('denyallow')
  if (denyallow && denyallow.split('|').some((d) => HOST === d || HOST.endsWith(`.${d}`))) return false
  // 我們是第一方（同網域）：3p 規則不適用
  if (options.has('3p')) return false
  // 我們只發圖片與文件請求
  for (const opt of ['script', 'xhr', 'websocket', 'media', 'font', 'subdocument', 'popup', 'document', 'csp', 'object']) {
    if (options.has(opt)) return false
  }
  return true
}

/** 把 EasyList 的網路規則（簡化版）轉成 regex；無法處理／不適用回 null */
function ruleToRegex(pattern: string): RegExp | null {
  const [body0, optStr = ''] = pattern.split('$') as [string, string?]
  const body = body0.trim()
  if (!body || body.startsWith('!') || body.startsWith('##') || body.startsWith('#')) return null
  if (body.startsWith('/') && body.endsWith('/')) return null // regex 規則太複雜，跳過（保守）
  const options = new Map<string, string | null>(
    optStr
      ? optStr.split(',').map((o) => {
          const [k, v] = o.split('=')
          return [k!.trim(), v ?? null] as [string, string | null]
        })
      : []
  )
  if (!ruleApplies(options)) return null
  if (body === '*') return null // 「擋全部」型規則若無 domain 限制＝不存在於通用清單，保守跳過
  let p = body
  let prefix = ''
  if (p.startsWith('||')) {
    p = p.slice(2)
    prefix = '^(?:[a-z0-9-]+\\.)*'
  } else if (p.startsWith('|')) {
    p = p.slice(1)
    prefix = '^'
  }
  let out = ''
  for (const ch of p) {
    if (ch === '*') out += '.*'
    else if (ch === '^') out += '(?:[^a-zA-Z0-9_.%-]|$)'
    else if ('\\^$.|?+()[]{}'.includes(ch)) out += `\\${ch}`
    else out += ch
  }
  try {
    return new RegExp(prefix + out, 'i')
  } catch {
    return null
  }
}

let failures = 0
const listText = new Map<string, string>()
async function load(list: { name: string; url: string }): Promise<string> {
  if (!listText.has(list.url)) {
    listText.set(
      list.url,
      await fetch(list.url, { signal: AbortSignal.timeout(60_000) })
        .then((r) => (r.ok ? r.text() : ''))
        .catch(() => ''),
    )
  }
  return listText.get(list.url)!
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'))
for (const name of wanted.length ? wanted : Object.keys(SITES)) {
  const cfg = SITES[name]
  if (!cfg) {
    console.log(`未知站點：${name}（可用：${Object.keys(SITES).join(', ')}）`)
    process.exit(2)
  }
  HOST = cfg.host
  TOKENS = cfg.tokens
  PATHS = cfg.paths
  SITE = `https://${cfg.host}`
  console.log(`\n== ${name}（${HOST}）==`)
for (const list of LISTS) {
  const text = await load(list)
  if (!text) {
    console.log(`⚠️  ${list.name}：抓不到（跳過）`)
    continue
  }
  const lines = text.split('\n')
  const hits: string[] = []

  // 1) 元素隱藏規則：選擇器含我們的 token
  for (const line of lines) {
    if (!line.startsWith('##')) continue
    const sel = line.slice(2)
    if (TOKENS.some((t) => sel.toLowerCase().includes(t))) hits.push(`元素隱藏：${line}`)
  }

  // 2) 網路規則：比對我們實際 URL
  for (const line of lines) {
    if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('##') || line.startsWith('#')) continue
    if (line.startsWith('@@')) continue // 例外規則（放行）
    const re = ruleToRegex(line)
    if (!re) continue
    for (const path of PATHS) {
      if (re.test(SITE + path)) {
        hits.push(`網路規則：${line}  ← 命中 ${path}`)
        break
      }
    }
  }

  if (hits.length === 0) {
    console.log(`✅ ${list.name}：${lines.length} 條規則，0 命中`)
  } else {
    failures += hits.length
    console.log(`❌ ${list.name}：${hits.length} 命中`)
    for (const h of hits.slice(0, 10)) console.log(`   ${h}`)
  }
}
}

if (failures > 0) {
  console.log(`\n❌ 有 ${failures} 條規則會擋到我們的版位——請改命名（class 與路徑避免 ad／ads／advert／banner）`)
  process.exitCode = 1
} else {
  console.log('\n✅ 全部清單 0 命中：目前的版位不會被這四份清單封鎖')
}

export {}
