import Factory from '../Factory'
import { ApplicationCommand, ApplicationCommandData, Collection, Guild, Interaction } from 'discord.js'
import { CommandEntity } from '../entities/Command'
import NodeEmitter from '../utils/NodeEmitter'
import { ProviderEntity } from '../entities/Provider'
import EntityFile from '../utils/EntityFile'

export default class CommandManager {
  constructor (public factory: Factory) {
  }

  public async register (): Promise<void> {
    const container = this.factory.ignitor.container.commands
    const files = this.factory.ignitor.files.filter((file: { type: string }) => file.type === 'command')

    await Promise.all(
      files.map(async (item) => {
        const instance = new item.default()
        const entityFile = new EntityFile(item.file.path)

        const command = new CommandEntity(
          undefined,
          instance.scope,
          instance.roles,
          instance.ctx,
          instance.run,
          entityFile
        )

        container.push(command)

        this.factory.ignitor.container.providers.forEach((provider: ProviderEntity) => {
          provider.load(command)
        })
      })
    )

    await this.insertCommands()
  }

  public async insertCommands (): Promise<void> {
    const container = this.factory.ignitor.container

    const globalCommands = container.commands
      .map((command: CommandEntity) => command.scope === 'GLOBAL' && {
        ...command.context,
        permissions: command.roles.map((role: string) => ({ id: role, type: 'ROLE', permission: true })),
      })
      .filter(a => a)

    await this.factory.client?.application?.commands.set(globalCommands as unknown as ApplicationCommandData[])

    const guildCommandEntities = container.commands
      .map((command: CommandEntity) => command.scope !== 'GLOBAL' && command)
      .filter(a => a) as CommandEntity[]

    const collection = new Collection<string, CommandEntity[]>()
    guildCommandEntities.forEach((command: CommandEntity) => {
      const scopes = command.scope as string[]
      scopes.forEach((scope: string) => {
        const guild = collection.get(scope)
        if (!guild) {
          collection.set(scope, [command])
          return
        }
        guild?.push(command)
      })
    })

    collection.map(async (commands: CommandEntity[], key: string) => {
      const guild: Guild | undefined = this.factory.client!.guilds.cache.get(key)

      const cacheCommands = await guild?.commands.set(commands.map((command: CommandEntity) => ({
        ...command.ctx,
        ...command.roles.length && { defaultPermission: false },
      })))

      await guild?.commands.permissions.set({
        fullPermissions: await Promise.all(commands.map(async (command: CommandEntity) => {
          const registeredCommand: ApplicationCommand | undefined = cacheCommands?.find((applicationCommand: ApplicationCommand) => (
            applicationCommand.name === command.ctx.name
          ))

          return {
            id: registeredCommand!.id,
            permissions: command.roles.map((role: string) => ({
              id: role,
              type: 'ROLE' as any,
              permission: true,
            })),
          }
        })),
      })

      NodeEmitter.emit(
        'application::commands::registered',
        this.factory.ignitor.container.commands
      )

      commands.forEach((command: CommandEntity) => {
        this.factory.client?.on('interactionCreate', async (interaction: Interaction) => {
          if (!interaction.isCommand()) {
            return
          }

          if (interaction.commandName.toLowerCase() === command.ctx.name.toLowerCase()) {
            await command.run(interaction)
          }
        })
      })
    })
  }
}