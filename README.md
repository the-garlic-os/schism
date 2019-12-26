# Bipolar
_Imitate everyone individually._

A totally-original Markov-chain-based Discord bot that keeps a separate Markov chain for each user. Can imitate a theoretically unlimited number of users.

## Environment variables
| Name | Description | Example | Default |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | The token you get when you make a Discord bot. discord.js uses this to log in. | `GEJG8tOVnw2Hyh4Olu.sBxf2FyEaQJ.cMq.lfsLzrSIzMFNf9d3qTqxRrnq` | `undefined` (**Required**) |
| `S3_BUCKET_NAME` | The name of the S3 bucket Bipolar will look for files in. | `my-s3-bucket` | `undefined` (**Required**) |
| `AWS_ACCESS_KEY_ID` | The token you get when you make an AWS user. This user needs R/W access to the S3 bucket you will use. | `R4AE78IHSJNVUFFRUPQN` | `undefined` (**Required**) |
| `AWS_SECRET_ACCESS_KEY` | Like part 2 for above?? idk completely how this works tbh but you need them both. | `S35s9WTHRgsoz5Ehh7cacGjjToLie7jcdS4vwpFs` | `undefined` (**Required**) |
| `AWS_REGION` | The region your S3 bucket is in. | `us-east-1` | `undefined` (**Required**) |
| `PREFIX` | Command prefix. | `\|` (e.g. `\|imitate me`) | `\|` |
| `CORPUS_DIR` | The S3 directory that Bipolar will store corpi in. | `bipolar/corpus` | `undefined` (**Required**) |
| `EMBED_COLORS` | A JSON-encoded dictionary of colors for `normal` and `error`. | `{"normal":"#A755B5", "error":"#FF3636"}` | `{"normal":"#A755B5", "error":"#FF3636"}` |
| `SPEAKING_CHANNELS` | A JSON-encoded dictionary of the channels Bipolar is allowed to speak in. | `{"random server name or whatever you want - #general":"<CHANNEL ID HERE>"}` | `{}` (**Required**) |
| `LEARNING_CHANNELS` | A JSON-encoded dictionary of the channels Bipolar is allowed to learn from. | `{"random server name or whatever you want - #general":"<CHANNEL ID HERE>"}` | `{}` (**Required**) |
| `NICKNAMES` | A JSON-encoded dictionary of any server-specific nicknames Bipolar has. | `"a server": ["<SERVER ID HERE>", "Bipolarn't"]` | `{}` (Optional) |
| `ADMINS` | A JSON-encoded dictionary of the users that are allowed to use Bipolar's admin commands. | `{"You, probably":"<USER ID HERE>"}` | `{}` (Recommended, but optional) |
| `BANNED` | A JSON-encoded dictionary of the users that aren't allowed to use Bipolar's commands. Bipolar will also stop learning from this user. | `{"Naughty boy":"<USER ID HERE>"}` | `{}` (Optional) |
| `BAD_WORDS_URL` | URL to a newline-delimited list of words that Bipolar will filter before saving messages to a corpus | `https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/raw/master/en` | `undefined` (Optional) |
| `DISABLE_LOGS` | Silence in the console. Keep Bipolar from outputting any logs. | (`true`/`false`) | `false` (Bipolar will log stuff like normal) |
| `PLAIN_TEXT` | Make imitate messages not use an embed. Enabled with any value. | `epiuvnseriobunw` | `undefined` |


## TODO
- Keep data per server separate
- "Forget" command to delete the data on that user (legally required by the GDPR? <sup>/s</sup>)
- Message rate limiting to mitigate spam
- I probably need to split `index.js` into more files again
