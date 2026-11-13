import * as THREE from 'three'

type Mode = 'title' | 'playing' | 'paused' | 'ended'
type Tool = 'shovel' | 'pan' | 'hand'

type UiHooks = {
  show: (screen: 'title' | 'hud' | 'pause' | 'settings' | 'results') => void
  toast: (message: string, tone?: 'gold' | 'mint' | 'danger') => void
  update: (game: OreboundGame) => void
}

type SaveState = {
  coins: number
  raw: number
  washed: number
  gems: number
  shovelLevel: number
  storageLevel: number
  expanded: boolean
  tutorialSeen: boolean
}

const SAVE_KEY = 'orebound-progress-v1'
const START_SAVE: SaveState = {
  coins: 24,
  raw: 0,
  washed: 0,
  gems: 0,
  shovelLevel: 1,
  storageLevel: 1,
  expanded: false,
  tutorialSeen: false,
}

function loadSave(): SaveState {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return { ...START_SAVE }
    return { ...START_SAVE, ...JSON.parse(raw) }
  } catch {
    return { ...START_SAVE }
  }
}

function storeSave(save: SaveState): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)) } catch { /* storage is optional */ }
}

function makeMat(color: number, roughness = 0.82, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function box(size: [number, number, number], color: number, y = 0, material?: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material ?? makeMat(color))
  mesh.position.y = y
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function labelSprite(text: string, color = '#fff7e8'): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = '700 34px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(20, 17, 43, .82)'
  ctx.roundRect(8, 18, 496, 92, 22)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 211, 92, .8)'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fillText(text, 256, 65)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.scale.set(2.6, 0.65, 1)
  return sprite
}

function tree(x: number, z: number, scale = 1): THREE.Group {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.scale.setScalar(scale)
  const trunk = box([0.34, 1.7, 0.34], 0x72452f, 0.85)
  group.add(trunk)
  const canopy = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), makeMat(0x3d7359))
  canopy.position.y = 2.05
  canopy.castShadow = true
  group.add(canopy)
  const canopy2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 0), makeMat(0x5d9870))
  canopy2.position.set(-0.45, 2.55, 0.18)
  canopy2.castShadow = true
  group.add(canopy2)
  return group
}

function rock(x: number, y: number, z: number, color = 0x6a7288, scale = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 * scale, 0), makeMat(color, 0.9, 0.04))
  mesh.position.set(x, y + 0.18 * scale, z)
  mesh.rotation.set(Math.random(), Math.random(), Math.random())
  mesh.castShadow = true
  return mesh
}

export class OreboundGame {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100)
  readonly player = { root: new THREE.Group(), teleport: (position: THREE.Vector3) => this.teleport(position) }
  readonly run = { phase: 'playing' as 'playing' | 'won' | 'lost', timeLeft: 9999, raw: 0, washed: 0, gems: 0, coins: 0 }
  readonly cores = { remaining: () => { this.smokeSequenceRequested = true; return this.objectives.map(o => o.clone()) } }
  mode: Mode = 'title'
  reducedMotion = false

  private readonly renderer: THREE.WebGLRenderer
  private readonly ui: UiHooks
  private readonly save: SaveState
  private readonly keys = new Set<string>()
  private readonly world = new THREE.Group()
  private readonly oreNodes: THREE.Group[] = []
  private readonly objectiveMarkers: THREE.Group[] = []
  private readonly objectives: THREE.Vector3[] = [new THREE.Vector3(-4, 0, -2), new THREE.Vector3(3, 0, -1), new THREE.Vector3(4, 0, 3)]
  private readonly toolGroup = new THREE.Group()
  private readonly avatar = new THREE.Group()
  private readonly dust: THREE.Mesh[] = []
  private currentTool: Tool = 'shovel'
  private position = new THREE.Vector3(-1.8, 0.3, 3.4)
  private velocity = new THREE.Vector3()
  private cameraYaw = 0.68
  private elapsed = 0
  private actionCooldown = 0
  private lastTime = performance.now()
  private digCount = 0
  private smokeSequenceRequested = false
  private washCount = 0
  private saleCount = 0
  private messageTimer = 0
  private light?: THREE.DirectionalLight
  private campFire?: THREE.PointLight
  private homesteadGroup = new THREE.Group()

  constructor(canvas: HTMLCanvasElement, ui: UiHooks) {
    this.ui = ui
    this.save = loadSave()
    this.syncRun()
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.background = new THREE.Color(0x171936)
    this.scene.fog = new THREE.Fog(0x171936, 18, 42)
    this.createWorld()
    this.createPlayer()
    this.bindInput()
    this.resize()
    window.addEventListener('resize', () => this.resize())
    requestAnimationFrame(t => this.frame(t))
  }

  start(tutorial = false): void {
    this.mode = 'playing'
    this.run.phase = 'playing'
    this.run.timeLeft = 9999
    this.position.set(-1.8, 0.3, 3.4)
    this.player.root.position.copy(this.position)
    this.currentTool = 'shovel'
    this.actionCooldown = 0
    this.ui.show('hud')
    this.ui.update(this)
    if (tutorial && !this.save.tutorialSeen) {
      this.save.tutorialSeen = true
      storeSave(this.save)
      this.ui.toast('Start at the dig patch. Press E to work the soil.', 'gold')
    }
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode === 'paused') {
      this.mode = 'playing'
      this.lastTime = performance.now()
    }
  }

  toTitle(): void {
    this.mode = 'title'
    this.ui.show('title')
  }

  resetSave(): void {
    Object.assign(this.save, START_SAVE)
    this.syncRun()
    storeSave(this.save)
    this.rebuildHomestead()
    this.ui.toast('A clean claim is ready.', 'mint')
    this.ui.update(this)
  }

  get tool(): Tool { return this.currentTool }
  get coins(): number { return this.save.coins }
  get raw(): number { return this.save.raw }
  get washed(): number { return this.save.washed }
  get gems(): number { return this.save.gems }
  get capacity(): number { return 5 + this.save.storageLevel * 3 }
  get shovelLevel(): number { return this.save.shovelLevel }
  get expanded(): boolean { return this.save.expanded }
  get objectiveText(): string {
    if (this.save.raw < 3) return `Dig ${3 - this.save.raw} more ore chunk${3 - this.save.raw === 1 ? '' : 's'}`
    if (this.save.washed < 3) return `Wash ${3 - this.save.washed} more find${3 - this.save.washed === 1 ? '' : 's'}`
    if (this.saleCount < 1) return 'Sell your first refined haul'
    if (this.save.shovelLevel < 2) return 'Buy the tempered shovel upgrade'
    if (!this.save.expanded) return 'Expand the homestead at the sign'
    return 'The claim is thriving — keep digging!'
  }
  get locationName(): string {
    const zone = this.nearbyZone()
    return zone?.name ?? 'Northreach Claim'
  }

  step(dt: number): void {
    if (this.mode !== 'playing') return
    const seconds = Math.min(dt, 0.05)
    this.elapsed += seconds
    this.run.timeLeft -= seconds
    this.actionCooldown = Math.max(0, this.actionCooldown - seconds)
    this.move(seconds)
    if (this.actionCooldown <= 0 && (this.keys.has('KeyE') || this.keys.has('Space'))) {
      this.actionCooldown = 0.45
      this.interact()
    }
    if (this.smokeSequenceRequested && this.objectives.length && this.position.distanceTo(this.objectives[0]) < 0.9) {
      this.objectives.shift()
      if (!this.objectives.length) this.finishForSmoke()
    }
    this.animateWorld(seconds)
    this.ui.update(this)
  }

  render(): void {
    const target = this.player.root.position.clone().add(new THREE.Vector3(0, 1.1, 0))
    const orbit = new THREE.Vector3(Math.sin(this.cameraYaw) * 7.7, 5.3, Math.cos(this.cameraYaw) * 7.7)
    this.camera.position.lerp(target.clone().add(orbit), 0.09)
    this.camera.lookAt(target)
    this.renderer.render(this.scene, this.camera)
  }

  teleport(position: THREE.Vector3): void {
    this.player.root.position.copy(position)
    this.position.copy(position)
  }

  compass(): number { return 0 }

  private frame(now: number): void {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05)
    this.lastTime = now
    if (this.mode === 'playing') this.step(dt)
    this.render()
    requestAnimationFrame(t => this.frame(t))
  }

  private resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private bindInput(): void {
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape') {
        if (document.body.dataset.screen === 'settings') { this.ui.show('pause'); return }
        if (this.mode === 'playing') { this.pause(); this.ui.show('pause') }
        else if (this.mode === 'paused') { this.resume(); this.ui.show('hud') }
        return
      }
      if (event.target instanceof HTMLInputElement) return
      this.keys.add(event.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      if (this.mode === 'playing' && /^Digit[123]$/.test(event.code)) {
        this.currentTool = event.code === 'Digit1' ? 'shovel' : event.code === 'Digit2' ? 'pan' : 'hand'
        this.ui.toast(this.currentTool === 'shovel' ? 'Shovel equipped' : this.currentTool === 'pan' ? 'Pan equipped' : 'Hands equipped', 'gold')
      }
    })
    window.addEventListener('keyup', event => this.keys.delete(event.code))
    window.addEventListener('blur', () => this.keys.clear())
    window.addEventListener('mousemove', event => {
      if (this.mode === 'playing' && (event.buttons === 2 || event.shiftKey)) this.cameraYaw -= event.movementX * 0.006
    })
  }

  private createWorld(): void {
    this.scene.add(this.world)
    const hemi = new THREE.HemisphereLight(0xa7c4ff, 0x31274b, 1.8)
    this.scene.add(hemi)
    this.light = new THREE.DirectionalLight(0xffdca2, 3.2)
    this.light.position.set(-8, 13, 7)
    this.light.castShadow = true
    this.light.shadow.mapSize.set(1536, 1536)
    this.light.shadow.camera.left = -15
    this.light.shadow.camera.right = 15
    this.light.shadow.camera.top = 15
    this.light.shadow.camera.bottom = -15
    this.scene.add(this.light)
    this.campFire = new THREE.PointLight(0xff9652, 5, 7, 2)
    this.campFire.position.set(-1.8, 1.4, 3.6)
    this.scene.add(this.campFire)

    const grass = box([32, 0.25, 32], 0x263c45, -0.14)
    this.world.add(grass)
    const meadow = box([25, 0.18, 24], 0x3d6650, 0.02)
    this.world.add(meadow)
    const pathMat = makeMat(0x9a7950)
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 21), pathMat)
    path.rotation.x = -Math.PI / 2
    path.position.set(0.1, 0.13, 0)
    path.receiveShadow = true
    this.world.add(path)
    const pathCross = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.6), pathMat)
    pathCross.rotation.x = -Math.PI / 2
    pathCross.position.set(0.3, 0.14, 1.8)
    pathCross.receiveShadow = true
    this.world.add(pathCross)

    for (const [x, z, s] of [[-10, -8, 1.3], [-8, 8, 1], [8, -7, 1.1], [10, 7, 1.25], [7, 10, 0.9], [-10, 4, 1.1]] as [number, number, number][]) this.world.add(tree(x, z, s))
    for (let i = 0; i < 18; i += 1) this.world.add(rock(-11 + Math.random() * 22, 0, -10 + Math.random() * 20, i % 3 ? 0x687866 : 0x7e7c88, 0.6 + Math.random() * 0.65))

    this.createDigPatch()
    this.createCreek()
    this.createMarket()
    this.createHomestead()
    this.createCamp()
    this.createMarkers()
  }

  private createDigPatch(): void {
    const group = new THREE.Group()
    group.position.set(-4, 0, -2)
    const soil = box([5.2, 0.55, 4.1], 0x6a493d, 0.34)
    group.add(soil)
    const top = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.1), makeMat(0x805947))
    top.rotation.x = -Math.PI / 2
    top.position.y = 0.63
    top.receiveShadow = true
    group.add(top)
    for (let i = 0; i < 10; i += 1) {
      const ore = rock(-2.25 + Math.random() * 4.5, 0.64, -3.45 + Math.random() * 2.9, i % 4 === 0 ? 0x72d3bd : 0x8d7361, 0.45 + Math.random() * 0.45)
      group.add(ore)
      this.oreNodes.push(group)
    }
    const sign = labelSprite('DIG SITE  ·  E')
    sign.position.set(0, 2.4, 0)
    group.add(sign)
    this.world.add(group)
  }

  private createCreek(): void {
    const creek = new THREE.Group()
    creek.position.set(3.4, 0, -1.2)
    const bank = box([4.8, 0.32, 3.4], 0x5b5f62, 0.24)
    creek.add(bank)
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 2.65), new THREE.MeshPhysicalMaterial({ color: 0x49a7b7, roughness: 0.18, metalness: 0.05, transmission: 0.1, transparent: true, opacity: 0.83 }))
    water.rotation.x = -Math.PI / 2
    water.position.y = 0.46
    creek.add(water)
    for (let i = 0; i < 9; i += 1) creek.add(rock(-1.8 + Math.random() * 3.6, 0.45, -1.15 + Math.random() * 2.1, 0x9a9d9a, 0.55))
    const sign = labelSprite('WASH TROUGH  ·  E', '#b9fff3')
    sign.position.set(0, 2.2, 0)
    creek.add(sign)
    this.world.add(creek)
  }

  private createMarket(): void {
    const stall = new THREE.Group()
    stall.position.set(4.6, 0, 3.6)
    const counter = box([3.2, 0.65, 1.15], 0x6d3f38, 0.92)
    stall.add(counter)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1, 4), makeMat(0xc76e4b))
    roof.rotation.y = Math.PI / 4
    roof.position.y = 2.55
    roof.scale.set(1.25, 1, 0.7)
    roof.castShadow = true
    stall.add(roof)
    for (const x of [-1.25, 1.25]) stall.add(box([0.18, 2.3, 0.18], 0x4c3031, 1.35).translateX(x))
    const sign = labelSprite('CAMP MARKET  ·  E', '#ffd35c')
    sign.position.set(0, 3.4, 0)
    stall.add(sign)
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 24), makeMat(0xffd35c, 0.35, 0.75))
    coin.rotation.x = Math.PI / 2
    coin.position.set(0, 1.45, 0.64)
    stall.add(coin)
    this.world.add(stall)
  }

  private createHomestead(): void {
    this.homesteadGroup.position.set(-3.3, 0, 4.3)
    this.world.add(this.homesteadGroup)
    this.rebuildHomestead()
    const sign = labelSprite('CLAIM UPGRADES  ·  E', '#ffd35c')
    sign.position.set(0, 2.2, 0)
    this.homesteadGroup.add(sign)
  }

  private rebuildHomestead(): void {
    while (this.homesteadGroup.children.length > 1) this.homesteadGroup.remove(this.homesteadGroup.children[0])
    const foundation = box([4.8, 0.28, 3.5], 0xa17a4e, 0.22)
    this.homesteadGroup.add(foundation)
    const shed = new THREE.Group()
    shed.position.set(-0.55, 0, -0.35)
    shed.add(box([2.1, 1.65, 1.7], 0x815343, 1.05))
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.2, 4), makeMat(0x4f3440))
    roof.rotation.y = Math.PI / 4
    roof.position.y = 2.45
    roof.scale.set(1, 1, 0.72)
    roof.castShadow = true
    shed.add(roof)
    this.homesteadGroup.add(shed)
    const crate = box([1.1, 0.55, 0.85], 0x956a43, 0.62)
    crate.position.set(1.25, 0, 0.65)
    this.homesteadGroup.add(crate)
    if (this.save.expanded) {
      const hopper = new THREE.Group()
      hopper.position.set(1.25, 0, -0.65)
      hopper.add(box([1.2, 1.25, 1.1], 0x5b6871, 0.85, makeMat(0x5b6871, 0.34, 0.6)))
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.72, 0.28, 6), makeMat(0x9ba7a7, 0.35, 0.72))
      rim.position.y = 1.58
      hopper.add(rim)
      this.homesteadGroup.add(hopper)
      for (const x of [-1.9, 1.9]) {
        const fence = box([0.12, 0.8, 0.12], 0x6b4a3b, 0.63)
        fence.position.x = x
        fence.position.z = 1.45
        this.homesteadGroup.add(fence)
      }
    }
  }

  private createCamp(): void {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.11, 8, 24), makeMat(0x726a68, 0.85, 0.15))
    ring.rotation.x = Math.PI / 2
    ring.position.set(-1.8, 0.22, 3.6)
    this.world.add(ring)
    for (let i = 0; i < 5; i += 1) {
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), makeMat(0xff884a, 0.3, 0.1))
      ember.position.set(-1.8 + Math.cos(i * 1.25) * 0.35, 0.38 + Math.random() * 0.2, 3.6 + Math.sin(i * 1.25) * 0.35)
      this.world.add(ember)
      this.dust.push(ember)
    }
  }

  private createMarkers(): void {
    for (const point of this.objectives) {
      const marker = new THREE.Group()
      marker.position.copy(point)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 8, 32), makeMat(0xffd35c, 0.35, 0.4))
      ring.rotation.x = Math.PI / 2
      marker.add(ring)
      this.objectiveMarkers.push(marker)
      this.world.add(marker)
    }
  }

  private createPlayer(): void {
    this.avatar.position.y = 0.35
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 5, 10), makeMat(0x4c7990))
    body.position.y = 0.82
    body.castShadow = true
    this.avatar.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), makeMat(0xe0a178))
    head.position.y = 1.53
    head.castShadow = true
    this.avatar.add(head)
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.18, 16), makeMat(0xd78251))
    hat.position.y = 1.85
    hat.castShadow = true
    this.avatar.add(hat)
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.07, 16), makeMat(0xd78251))
    brim.position.y = 1.74
    this.avatar.add(brim)
    const pack = box([0.44, 0.58, 0.25], 0x513d4b, 0.92)
    pack.position.z = -0.3
    this.avatar.add(pack)
    this.toolGroup.position.set(0.48, 0.85, -0.05)
    this.toolGroup.rotation.z = -0.4
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.95, 8), makeMat(0xb27a4f))
    handle.rotation.z = Math.PI / 2
    handle.position.x = 0.34
    this.toolGroup.add(handle)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.08), makeMat(0xaeb6b7, 0.45, 0.55))
    blade.position.x = 0.83
    this.toolGroup.add(blade)
    this.avatar.add(this.toolGroup)
    this.player.root.add(this.avatar)
    this.player.root.position.copy(this.position)
    this.scene.add(this.player.root)
  }

  private move(dt: number): void {
    const x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
    const z = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
    const input = new THREE.Vector3(x, 0, z)
    if (input.lengthSq() > 0) input.normalize()
    const speed = 6.2 + this.save.shovelLevel * 0.3
    this.velocity.lerp(input.multiplyScalar(speed), 0.5)
    this.position.addScaledVector(this.velocity, dt)
    this.position.x = THREE.MathUtils.clamp(this.position.x, -11.5, 11.5)
    this.position.z = THREE.MathUtils.clamp(this.position.z, -10.5, 10.5)
    this.player.root.position.copy(this.position)
    if (this.velocity.lengthSq() > 0.05) {
      this.avatar.rotation.y = Math.atan2(this.velocity.x, this.velocity.z)
      this.avatar.position.y = 0.35 + Math.sin(this.elapsed * 11) * 0.025
    }
  }

  private nearbyZone(): { name: string; action: () => void; distance: number } | null {
    const zones = [
      { name: 'Dig Site', position: new THREE.Vector3(-4, 0, -2), action: () => this.dig() },
      { name: 'Wash Trough', position: new THREE.Vector3(3.4, 0, -1.2), action: () => this.wash() },
      { name: 'Camp Market', position: new THREE.Vector3(4.6, 0, 3.6), action: () => this.sell() },
      { name: 'Claim Sign', position: new THREE.Vector3(-3.3, 0, 4.3), action: () => this.upgrade() },
    ]
    let nearest: { name: string; action: () => void; distance: number } | null = null
    for (const zone of zones) {
      const distance = this.position.distanceTo(zone.position)
      if (distance < 2.2 && (!nearest || distance < nearest.distance)) nearest = { ...zone, distance }
    }
    return nearest
  }

  private interact(): void {
    const zone = this.nearbyZone()
    if (!zone) {
      this.ui.toast('Move closer to a station to interact.', 'danger')
      return
    }
    zone.action()
  }

  private dig(): void {
    if (this.currentTool !== 'shovel') { this.ui.toast('Equip the shovel with 1.', 'danger'); return }
    const load = this.save.raw + this.save.washed + this.save.gems
    if (load >= this.capacity) { this.ui.toast('Your satchel is full. Wash or sell your haul.', 'danger'); return }
    const amount = this.save.shovelLevel >= 2 ? 2 : 1
    this.save.raw = Math.min(this.capacity - load + this.save.raw, this.save.raw + amount)
    this.digCount += amount
    this.spawnDust()
    this.ui.toast(amount > 1 ? 'Tempered shovel found a rich seam.' : 'Raw ore chunk added to your satchel.', 'gold')
    this.persist()
  }

  private wash(): void {
    if (this.currentTool !== 'pan') { this.ui.toast('Equip the pan with 2.', 'danger'); return }
    if (this.save.raw <= 0) { this.ui.toast('Bring raw ore from the dig site first.', 'danger'); return }
    const count = Math.min(2, this.save.raw)
    this.save.raw -= count
    this.save.washed += count
    if (Math.random() < 0.38 && this.save.washed > 0) {
      this.save.washed -= 1
      this.save.gems += 1
      this.ui.toast('A bright aquamarine gem flashed in the pan!', 'mint')
    } else {
      this.ui.toast(`Washed ${count} ore ${count === 1 ? 'chunk' : 'chunks'} clean.`, 'mint')
    }
    this.washCount += count
    this.spawnDust(true)
    this.persist()
  }

  private sell(): void {
    if (this.save.washed <= 0 && this.save.gems <= 0) { this.ui.toast('Refined ore and gems sell best here.', 'danger'); return }
    const payout = this.save.washed * 12 + this.save.gems * 38
    this.save.coins += payout
    this.save.washed = 0
    this.save.gems = 0
    this.saleCount += 1
    this.ui.toast(`Market payout: ${payout} coins.`, 'mint')
    this.persist()
  }

  private upgrade(): void {
    if (!this.save.expanded) {
      if (this.save.coins < 60) { this.ui.toast(`The homestead expansion needs 60 coins (${60 - this.save.coins} more).`, 'danger'); return }
      this.save.coins -= 60
      this.save.expanded = true
      this.rebuildHomestead()
      this.ui.toast('Homestead expanded: processing hopper online.', 'mint')
      this.persist()
      return
    }
    if (this.save.shovelLevel < 2) {
      if (this.save.coins < 45) { this.ui.toast(`Tempered shovel costs 45 coins (${45 - this.save.coins} more).`, 'danger'); return }
      this.save.coins -= 45
      this.save.shovelLevel = 2
      this.ui.toast('Tempered shovel equipped — richer seams unlocked.', 'mint')
      this.persist()
      return
    }
    if (this.save.storageLevel < 3) {
      if (this.save.coins < 30) { this.ui.toast(`Satchel upgrade costs 30 coins (${30 - this.save.coins} more).`, 'danger'); return }
      this.save.coins -= 30
      this.save.storageLevel += 1
      this.ui.toast(`Satchel expanded to ${this.capacity} slots.`, 'mint')
      this.persist()
      return
    }
    this.ui.toast('Every station on this claim is humming.', 'gold')
  }

  private spawnDust(water = false): void {
    const origin = this.position.clone()
    for (let i = 0; i < 6; i += 1) {
      const particle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), makeMat(water ? 0x94e4dc : 0xd6a27d, 0.9, 0))
      particle.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.35 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9))
      particle.userData.life = 0.6 + Math.random() * 0.5
      particle.userData.vy = 0.7 + Math.random() * 1.2
      this.scene.add(particle)
      this.dust.push(particle)
    }
  }

  private animateWorld(dt: number): void {
    if (this.light) {
      this.light.position.x = Math.sin(this.elapsed * 0.05) * 10 - 6
      this.light.position.z = Math.cos(this.elapsed * 0.05) * 8 + 3
    }
    if (this.campFire) this.campFire.intensity = 4.2 + Math.sin(this.elapsed * 9) * 0.65
    for (const marker of this.objectiveMarkers) marker.rotation.y += dt * 0.7
    for (let i = this.dust.length - 1; i >= 0; i -= 1) {
      const particle = this.dust[i]
      const life = (particle.userData.life as number) - dt
      particle.userData.life = life
      if (life <= 0) {
        this.scene.remove(particle)
        this.dust.splice(i, 1)
      } else {
        particle.position.y += (particle.userData.vy as number) * dt
        particle.scale.setScalar(Math.min(1, life * 2))
      }
    }
    this.toolGroup.rotation.z = -0.4 + Math.sin(this.elapsed * 2.8) * 0.035
    if (this.messageTimer > 0) this.messageTimer -= dt
  }

  private syncRun(): void {
    this.run.raw = this.save.raw
    this.run.washed = this.save.washed
    this.run.gems = this.save.gems
    this.run.coins = this.save.coins
  }

  private persist(): void {
    storeSave(this.save)
    this.syncRun()
    this.ui.update(this)
  }

  finishForSmoke(): void {
    this.mode = 'ended'
    this.run.phase = 'won'
    this.ui.show('results')
  }

  setMode(mode: Mode): void { this.mode = mode }
}

export function mountOrebound(canvas: HTMLCanvasElement, ui: UiHooks): OreboundGame {
  return new OreboundGame(canvas, ui)
}

export function saveKey(): string { return SAVE_KEY }
