from typing import List, Union
from discord import ChannelType, Message
from bot import Parrot
from exceptions import NotRegisteredError

import os
import logging
from discord.ext import commands
from utils import regex


class MessageEventHandler(commands.Cog):
    def __init__(self, bot: Parrot):
        self.bot = bot


    @commands.Cog.listener()
    async def on_message(self, message: Message) -> None:
        """
        Handle receiving messages.
        Monitors messages of registered users.
        """
        if message.author.id == self.bot.user.id:
            return

        # I am a mature person making a competent Discord bot.
        if (
            message.content == "ayy"
            and
            os.environ.get("AYY_LMAO", None) in ("true", "True", "1")
        ):
            await message.channel.send("lmao")

        # Ignore NotRegisteredError errors; Parrot shouldn't learn from
        #   non-registered users, anyway.
        try:
            learned_count = self.bot.learn_from(message)
            tag = f"{message.author.name}#{message.author.discriminator}"

            # Log results.
            if learned_count == 1:
                logging.info(f"Collected a message (ID: {message.id}) from user {tag} (ID: {message.author.id})")
            elif learned_count != 0:
                logging.info(f"Collected {learned_count} messages from {tag} (ID: {message.author.id})")
        except NotRegisteredError:
            pass

        # Imitate again when someone replies to an imitate message.
        # if message.reference is not None:
        #     src_message = await message.channel.fetch_message(
        #         message.reference.message_id
        #     )
        #     if (src_message is not None and
        #         src_message.webhook_id is not None and
        #         src_message.channel.id in self.bot.speaking_channels):
        #         try:
        #             # HACK: Get the ID of the user Parrot imitated in this
        #             # message through the message's AVATAR URL.
        #             # Really relying on implementation quirks here, but I don't
        #             # want to put in the effort to, like, log which messages
        #             # imitate who or something like that to be able to do this
        #             # properly.
        #             # If Discord ever changes the structure of their avatar URLs
        #             # or if I change Parrot to use different avatars, this will
        #             # probably break. But I guess now we'll just cross that
        #             # bridge when it comes.
        #             avatar_url = str(src_message.author.avatar_url)
        #             user_id = avatar_url.split("/")[4]
        #             message.content = user_id
        #             ctx = await self.bot.get_context(message)
        #             imitate_command = self.bot.get_command("imitate")
        #             await imitate_command.prepare(ctx)
        #             await imitate_command(ctx, user_id)
        #         except Exception as e:
        #             # Don't try to make amends if this feature fails. It isn't
        #             # that important.
        #             pass


def setup(bot: Parrot) -> None:
    bot.add_cog(MessageEventHandler(bot))
