import './styles/main.css'
import { mountOrebound, type OreboundGame } from './orebound'

type Screen = 'title' | 'hud' | 'pause' | 'settings' | 'results'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const root = document.querySelector<HTMLDivElement>('#ui')!

root.innerHTML = `
  <section class="screen screen-title is-active" data-screen="title">
    <div class="title-wash"></div>
    <div class="title-copy">
      <p class="eyebrow">NORTHREACH CLAIM · DAY 01</p>
      <h1 class="logo-text">OREBOUND</h1>
      <p class="tagline">Turn stubborn ground into a living claim.</p>
      <div class="title-rule"><span></span><i></i><span></span></div>
      <p class="title-note">A cozy hands-on mining adventure</p>
      <div class="menu menu-title">
        <button class="btn btn-primary" data-action="play"><span class="btn-glyph">◆</span> Start digging</button>
        <button class="btn btn-quiet" data-action="reset">Reset claim</button>
      </div>
      <p class="controls-line"><b>WASD</b> move <b>1 / 2 / 3</b> tools <b>E</b> interact</p>
    </div>
    <div class="title-badge"><span>01</span><b>FRONTIER<br>FIELD NOTES</b></div>
  </section>

  <section class="screen screen-hud" data-screen="hud">
    <div class="hud-top">
      <div class="brand-lockup"><span class="brand-mark">✦</span><div><b>OREBOUND</b><small>NORTHREACH CLAIM</small></div></div>
      <div class="hud-location"><span class="status-dot"></span><span id="location">Northreach Claim</span></div>
      <div class="hud-coins"><span class="coin-icon">◈</span><strong id="coins">24</strong><span>coins</span></div>
    </div>
    <div class="hud-left panel">
      <div class="panel-label">SATCHEL <span id="capacity">0 / 8</span></div>
      <div class="inventory-row"><span class="resource-icon raw-icon">●</span><div><b id="raw">0</b><small>raw ore</small></div></div>
      <div class="inventory-row"><span class="resource-icon wash-icon">≈</span><div><b id="washed">0</b><small>washed ore</small></div></div>
      <div class="inventory-row"><span class="resource-icon gem-icon">◆</span><div><b id="gems">0</b><small>gems</small></div></div>
      <div class="satchel-meter"><i id="satchel-meter"></i></div>
    </div>
    <div class="hud-right panel">
      <div class="panel-label">FIELD NOTES</div>
      <div class="objective-kicker">NEXT OBJECTIVE</div>
      <div class="objective" id="objective">Dig 3 ore chunks</div>
      <div class="objective-progress"><i id="objective-progress"></i></div>
      <p class="field-copy">Make the ground pay for itself. Every upgrade changes what this claim can become.</p>
    </div>
    <div class="hud-bottom">
      <div class="toolbelt panel">
        <div class="tool-slot active" id="tool-shovel"><span>1</span><b>SHOVEL</b><i>dig</i></div>
        <div class="tool-slot" id="tool-pan"><span>2</span><b>PAN</b><i>wash</i></div>
        <div class="tool-slot" id="tool-hand"><span>3</span><b>HANDS</b><i>build</i></div>
      </div>
      <div class="interaction-card" id="interaction"><b>WASD</b> move around the claim <span>·</span> <b>E</b> interact</div>
    </div>
    <div class="reticle">+</div>
    <div class="toast-stack" id="toasts"></div>
  </section>

  <section class="screen screen-modal" data-screen="pause">
    <div class="modal-backdrop"></div>
    <div class="modal panel-modal">
      <p class="eyebrow">NORTHREACH CLAIM</p><h2>Camp paused</h2><p class="modal-copy">The creek keeps moving. Your claim can wait.</p>
      <div class="menu">
        <button class="btn btn-primary" data-action="resume"><span class="btn-glyph">▶</span> Resume</button>
        <button class="btn btn-quiet" data-action="settings">Settings</button>
        <button class="btn btn-quiet" data-action="quit">Return to title</button>
      </div>
    </div>
  </section>

  <section class="screen screen-modal" data-screen="settings">
    <div class="modal-backdrop"></div>
    <div class="modal panel-modal">
      <p class="eyebrow">FIELD KIT</p><h2>Settings</h2>
      <div class="settings-list"><div><span>Motion</span><b>Reduced for this build</b></div><div><span>Audio</span><b>Ambient campfire</b></div><div><span>Controls</span><b>WASD · 1/2/3 · E · Esc</b></div></div>
      <button class="btn btn-primary" data-action="back-settings">Back to camp</button>
    </div>
  </section>

  <section class="screen screen-modal" data-screen="results">
    <div class="modal-backdrop"></div>
    <div class="modal panel-modal results-modal">
      <p class="eyebrow">CLAIM REPORT · DAY 01</p><h2>First light on the claim</h2><p class="modal-copy">You found the rhythm. The rest is just better ground, better tools, and a little patience.</p>
      <div class="report-grid"><div><b id="report-coins">24</b><span>coins on hand</span></div><div><b id="report-level">1</b><span>shovel level</span></div><div><b id="report-expand">NOT YET</b><span>homestead</span></div></div>
      <div class="menu menu-row"><button class="btn btn-primary" data-action="play"><span class="btn-glyph">◆</span> Keep digging</button><button class="btn btn-quiet" data-action="quit">Title</button></div>
    </div>
  </section>
`

let game: OreboundGame
const screens = [...root.querySelectorAll<HTMLElement>('[data-screen]')]

function show(screen: Screen): void {
  document.body.dataset.screen = screen
  for (const element of screens) element.classList.toggle('is-active', element.dataset.screen === screen)
}

function toast(message: string, tone: 'gold' | 'mint' | 'danger' = 'gold'): void {
  const stack = document.querySelector<HTMLDivElement>('#toasts')!
  const item = document.createElement('div')
  item.className = `toast toast-${tone}`
  item.textContent = message
  stack.appendChild(item)
  window.setTimeout(() => item.classList.add('is-leaving'), 2200)
  window.setTimeout(() => item.remove(), 2700)
}

function updateHud(active: OreboundGame): void {
  const load = active.raw + active.washed + active.gems
  const set = (id: string, value: string) => { const el = document.getElementById(id); if (el) el.textContent = value }
  set('location', active.locationName)
  set('coins', String(active.coins))
  set('raw', String(active.raw))
  set('washed', String(active.washed))
  set('gems', String(active.gems))
  set('capacity', `${load} / ${active.capacity}`)
  set('objective', active.objectiveText)
  set('report-coins', String(active.coins))
  set('report-level', String(active.shovelLevel))
  set('report-expand', active.expanded ? 'EXPANDED' : 'NOT YET')
  const meter = document.getElementById('satchel-meter') as HTMLElement | null
  if (meter) meter.style.transform = `scaleX(${Math.min(1, load / active.capacity)})`
  for (const id of ['shovel', 'pan', 'hand']) document.getElementById(`tool-${id}`)?.classList.remove('active')
  document.getElementById(`tool-${active.tool}`)?.classList.add('active')
  const interaction = document.getElementById('interaction')
  if (interaction) interaction.innerHTML = `<b>${active.tool === 'shovel' ? '1' : active.tool === 'pan' ? '2' : '3'}</b> ${active.tool === 'shovel' ? 'shovel' : active.tool === 'pan' ? 'pan' : 'hands'} equipped <span>·</span> <b>E</b> interact <em>${active.locationName}</em>`
}

function bindAction(action: string, fn: () => void): void {
  for (const element of root.querySelectorAll<HTMLElement>(`[data-action="${action}"]`)) element.addEventListener('click', fn)
}

bindAction('play', () => { game.start(true); show('hud') })
bindAction('resume', () => { game.resume(); show('hud') })
bindAction('settings', () => { document.body.dataset.screen = 'settings'; show('settings') })
bindAction('back-settings', () => { document.body.dataset.screen = 'pause'; show('pause') })
bindAction('quit', () => { game.toTitle(); show('title') })
bindAction('reset', () => { game.resetSave(); toast('A clean claim is ready.', 'mint') })

const hooks = { show, toast, update: updateHud }
game = mountOrebound(canvas, hooks)
show('title')
updateHud(game)

window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && document.querySelector('[data-screen="settings"]')?.classList.contains('is-active')) show('pause')
})

;(window as unknown as { __game: unknown }).__game = { game, ui: { show, toast }, input: { sensitivity: 1 } }
