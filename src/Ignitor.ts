import Factory from './Factory'
import { fetch, File } from 'fs-recursive'
import { Collection } from 'discord.js'
import AddonManager from './managers/AddonManager'
import Container from './Container'
import path from 'path'

export default class Ignitor {
  public files: Collection<string, any> = new Collection()
  public factory: Factory | undefined
  public kernel: any | undefined

  public readonly container: Container = new Container()
  public readonly addonManager: AddonManager = new AddonManager(this)

  public async createFactory () {
    await this.loadFiles('src')
    await this.loadFiles('providers')
    await this.loadKernel()
    this.factory = new Factory(this)
    await this.factory.init()

    return this
  }

  public async createCommand () {
    await this.loadFiles('src')
    await this.loadKernel()
    await this.addonManager.registerAddons()

    return this
  }

  private async loadFiles (dir) {
    const baseDir = path.join(process.cwd(), dir)
    const fetchedFiles = await fetch(
      baseDir,
      [process.env.NODE_ENV === 'production' ? 'js' : 'ts'],
      'utf-8',
      ['node_modules', 'test']
    )

    const files = Array.from(fetchedFiles, ([key, file]) => ({ key, ...file }))
    await Promise.all(
      files.map(async (file) => {
        const res = await import(file.path)

        if (res?.default?.type) {
          this.files.set(file.key, {
            type: res.default.type,
            default: res.default,
            file,
          })
        }
      }))
  }

  private async loadKernel () {
    const kernelPath = path.join(process.cwd(), 'start', 'Kernel.ts')
    const item = await import(kernelPath)
    this.kernel = new item.default()
  }
}