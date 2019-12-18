"use strict"

// Permissions code: 67584
// Send messages, read message history

// Load environment variables to const config
// JSON parse any value that is JSON parseable
const config = require("./defaults")
for (const key in process.env) {
	try {
		config[key] = JSON.parse(process.env[key])
	} catch (e) {
		config[key] = process.env[key]
	}
}

// Log errors when in production; crash when not in production
if (config.NODE_ENV === "production")
	process.on("unhandledRejection", logError)
else
	process.on("unhandledRejection", up => { throw up })

// Overwrite console methods with empty ones and don't require
//   console-stamp if logging is disabled
if (config.DISABLE_LOGS) {
	const methods = ["log", "debug", "warn", "info", "table"]
    for (const method of methods) {
        console[method] = () => {}
    }
} else {
	require("console-stamp")(console, {
		datePrefix: "",
		dateSuffix: "",
		pattern: " "
	})
}

// (Hopefully) save and clear cache before shutting down
process.on("SIGTERM", () => {
	console.info("Saving changes...")
	saveCache()
		.then(console.info("Changes saved."))
})

// Requirements
const fs      = require("fs"),
	  path    = require("path"),
      Discord = require("discord.js"),
      AWS     = require("aws-sdk"),
	  markov  = require("./markov"),
      embeds  = require("./embeds")(config.EMBED_COLORS),
	  help    = require("./help")

// Configure AWS-SDK to access an S3 bucket
AWS.config.update({
	accessKeyId: config.AWS_ACCESS_KEY_ID,
	secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
	region: "us-east-1"
})
const s3 = new AWS.S3()

// Array of promises that all have to complete before
//   Bipolar can log in
const init = []

// Local directories have to exist before they can be accessed
init.push(ensureDirectory("./cache"))

// Cache a list of user IDs to cut down on S3 requests
const userIdCache = []
init.push(s3listUserIds().then(userIds => {
	for (const userId of userIds) {
		userIdCache.push(userId)
	}
}))

// Set BAD_WORDS if BAD_WORDS_URL is defined
if (config.BAD_WORDS_URL) {
	init.push(httpsDownload(config.BAD_WORDS_URL)
		.then(rawData => config.BAD_WORDS = rawData.split("\n")))
}

// Reusable log messages
const log = {
	  say:     message => console.log(`${location(message)} Said: ${message.content}`)
	, embed:   message => console.log(`${location(message)} Said: ${message.embeds[0].fields[0].value}`)
	, imitate: message => console.log(`${location(message)} Imitated ${message.embeds[0].fields[0].name}, saying: ${message.embeds[0].fields[0].value}`)
	, error:   message => console.log(`${location(message)} Sent the error message: ${message.embeds[0].fields[0].value}`)
	, xok:     message => console.log(`${location(message)} Send the XOK message`)
	, help:    message => console.log(`${location(message)} Sent the Help message`)
}

const buffers = {},
      unsavedCache = []

const client = new Discord.Client()

// --- LISTENERS ---------------------------------------------

client.on("ready", () => {
	console.info(`Logged in as ${client.user.tag}.\n`)
	updateNicknames(config.NICKNAMES)

	// "Watching everyone"
	client.user.setActivity(`everyone (${config.PREFIX}help)`, { type: "WATCHING" })
		.then( ({ game }) => console.info(`Activity set: ${status(game.type)} ${game.name}`))

	channelTable(config.SPEAKING_CHANNELS).then(table => {
		console.info("Speaking in:")
		console.table(table)
	})
	.catch(console.warn)

	channelTable(config.LEARNING_CHANNELS).then(table => {
		console.info("Learning in:")
		console.table(table)
	})
	.catch(console.warn)

	nicknameTable(config.NICKNAMES).then(table => {
		console.info("Nicknames:")
		console.table(table)
	})
	.catch(console.warn)

})


client.on("message", message => {
	const authorId = message.author.id

	if (!isBanned(authorId) // Not banned from using Bipolar
	   && (canSpeakIn(message.channel.id) // Channel is either whitelisted or is a DM channel
		  || message.channel.type === "dm")
	   && message.author.id !== client.user.id) { // Not self

		// Ping
		if (message.isMentioned(client.user)
		   && !message.author.bot // Not a bot
		   && !message.content.includes(" ")) { // Message has no spaces (i.e. contains nothing but a ping)
			console.log(`${location(message)} Pinged by ${message.author.tag}.`)
			const userId = randomUserId()
			generateQuote(userId).then(sentence => {
				if (!sentence || sentence.length === 0) {
					message.channel.send(embeds.error("Who are you? What's going on? Where am I?"))
						.then(log.error)
				}
				embeds.imitate(userId, sentence, message.channel).then(embed => {
					message.channel.send(embed)
						.then(log.imitate)
				})
			})
		}

		// Command
		else if (message.content.startsWith(config.PREFIX)) {
			handleCommands(message)
		}
		
		// Nothing special
		else {
			// Maybe imitate someone anyway
			if (blurtChance()) {
				console.log(`${location(message)} Randomly decided to imitate someone in response to ${message.author.tag}'s message.`)
				const userId = randomUserId()
				generateQuote(userId).then(sentence => {
					embeds.imitate(userId, sentence, message.channel).then(embed => {
						message.channel.send(embed)
							.then(log.imitate)
					})
				})
			}

			if (learningIn(message.channel.id)
				&& message.content.length > 0) {
				/**
				 * Learn
				 * 
				 * Record the message to the user's corpus
				 * Builds up messages from that user until they have
				 *   been silent for at least five seconds,
				 * then writes them all to cache in one fell swoop.
				 * Messages will be saved for good come the next autosave.
				 */
				if (buffers.hasOwnProperty(authorId) && buffers[authorId].length > 0) {
					buffers[authorId] += message.content + "\n"

				} else {
					buffers[authorId] = message.content + "\n"
					setTimeout( () => {
						cleanse(buffers[authorId]).then(buffer => {
							if (buffer.length === 0) return

							appendCorpus(authorId, buffer).then( () => {
								if (!unsavedCache.includes(authorId))
									unsavedCache.push(authorId)

								if (!userIdCache.includes(authorId))
									userIdCache.push(authorId)

								console.log(`${location(message)} Learned from ${message.author.tag}:`, buffer)
								buffers[authorId] = ""
							})
						})
					}, 5000) // Five seconds
				}
			}
		}
	}
})


client.on("guildCreate", guild => {
	console.info(`---------------------------------
Added to a new server.
${guild.name} (ID: ${guild.id})
${guild.memberCount} members
---------------------------------`)
})

client.on("guildDelete", guild => {
	console.info(`---------------------------------
Removed from a server.
${guild.name} (ID: ${guild.id})
---------------------------------`)
})

// --- /LISTENERS --------------------------------------------

// --- LOGIN -------------------------------------------------

// When all initalization steps have finished
Promise.all(init).then( () => {
	console.info("Logging in...")
	client.login(process.env.DISCORD_BOT_TOKEN)

	// Autosave
	setInterval( () => {
		saveCache()
			.then(console.info("Saved cache."))
	}, 3600000) // One hour
})
.catch( () => {
	console.error("One or more initialization steps have failed:")
	console.error(init)
	throw "Startup failure"
})


// --- /LOGIN ------------------------------------------------

// --- FUNCTIONS ---------------------------------------------


/**
 * Generates a sentence based off [userId]'s corpus
 * 
 * @param {string} userId - ID corresponding to a user to generate a sentence from
 * @return {Promise<string|Error>} Resolve: sentence; Reject: error loading user's corpus
 */
function generateQuote(userId) {
	return new Promise( (resolve, reject) => {
		loadCorpus(userId).then(corpus => {
			const wordCount = ~~(Math.random() * 49 + 1) // 1-50 words
			const coherence = (Math.random() > 0.5) ? 2 : 6 // State size 2 or 6
			markov(corpus, wordCount, coherence).then(quote => {
				quote = quote.substring(0, 1024) // Hard cap of 1024 characters (embed field limit)
				resolve(quote)
			})
		})
		.catch(reject)
	})
}


function randomUserId() {
	const index = ~~(Math.random() * userIdCache.length - 1)
	return userIdCache[index]
}


/**
 * Scrapes [howManyMessages] messages from [channel].
 * Adds the messages to their corresponding user's corpus.
 * 
 * Here be dragons.
 *
 * @param {Channel} channel - what channel to scrape
 * @param {number} howManyMessages - number of messages to scrape
 * @return {Promise<number|Error>} number of messages added
 */
function scrape(channel, goal) {
	return new Promise( (resolve, reject) => { try {
		const fetchOptions = { limit: 100 /*, before: [last message from previous request]*/ }
		let activeLoops = 0
		let messagesAdded = 0
		const scrapeBuffers = {}

		function _getBatchOfMessages(fetchOptions) {
			activeLoops++
			channel.fetchMessages(fetchOptions).then(messages => {
				for (const userId in scrapeBuffers) {
					if (scrapeBuffers[userId].length > 1000) {
						appendCorpus(userId, scrapeBuffers[userId])
						scrapeBuffers[userId] = ""
					}
				}

				// Sometimes the last message is just undefined. No idea why.
				let lastMessages = messages.last()
				let toLast = 2
				while (!lastMessages[0]) {
					lastMessages = messages.last(toLast) // Second-to-last message (or third-to-last, etc.)
					toLast++
				}

				const lastMessage = lastMessages[0]

				// Sometimes the actual message is in "message[1]", instead "message". No idea why.
				fetchOptions.before = (Array.isArray(lastMessage))
					? lastMessage[1].id
					: lastMessage.id

				if (messages.size >= 100 && messagesAdded < goal) // Next request won't be empty and goal is not yet met
					_getBatchOfMessages(fetchOptions)

				for (let message of messages) {
					if (messagesAdded >= goal) break
					if (Array.isArray(message)) message = message[1] // In case message is actually in message[1]
					if (message.content) { // Make sure that it's not undefined
						const authorId = message.author.id
						scrapeBuffers[authorId] += message.content + "\n"
						messagesAdded++

						if (!unsavedCache.includes(authorId))
							unsavedCache.push(authorId)

						if (!userIdCache.includes(authorId))
							userIdCache.push(authorId)
					}
				}
				activeLoops--
			})
		}
		_getBatchOfMessages(fetchOptions)

		const whenDone = setInterval( () => {
			if (activeLoops === 0) {
				clearInterval(whenDone)
				for (const userId in scrapeBuffers) {
					appendCorpus(userId, scrapeBuffers[userId])
				}
				resolve(messagesAdded)
			}
		}, 100)
	
	} catch (err) {
		reject(err)
	}})
}


/**
 * Remove "undefined" from the beginning of any given corpus that has it.
 * 
 * @param {Array} userIds - array of user IDs to sort through; if undefined, all available corpi are scanned
 * @return {Promise<Array>} this never rejects lol. Resolve: array of user IDs where an "undefined" was removed
 */
function filterUndefineds(userIds) {
	function filter(userId) {
		return new Promise( async (resolve, reject) => {
			let corpus
			let inCache = false
			try {
				corpus = await cacheRead(userId)
				inCache = true
			} catch (e) {
				corpus = await s3read(userId)
			}
			if (corpus.startsWith("undefined")) {
				corpus = corpus.substring(9) // Remove the first nine characters (which is "undefined")

				if (inCache)
					cacheWrite(userId, corpus)
				else
					s3Write(userId, corpus)

				resolve(userId)
			} else {
				reject()
			}
		})
	}

	return new Promise( (resolve, reject) => {
		userIds = userIds || s3listUserIds()

		const found = []
		const promises = []
		for (const userId of userIds) {
			promises.push(filter(userId)
				.then(found.push))
				.catch()
		}
		Promise.all(promises)
			.then(resolve(found))
	})
}


/**
 * Parses a message whose content is presumed to be a command
 *   and performs the corresponding action.
 * 
 * Here be dragons.
 * 
 * @param {Message} messageObj - Discord message to be parsed
 * @return {Promise<string>} Resolve: name of command performed; Reject: error
 */
function handleCommands(message) {
	return new Promise ( (resolve, reject) => {
		if (message.author.bot) return resolve(null)

		console.log(`${location(message)} Received a command from ${message.author.tag}: ${message.content}`)

		const args = message.content.slice(config.PREFIX.length).split(/ +/)
		const command = args.shift().toLowerCase()

		try {
			const admin = isAdmin(message.author.id)
			switch (command) {
				case "help":
					const embed = new Discord.RichEmbed()
						.setColor(config.EMBED_COLORS.normal)
						.setTitle("Help")
					
					// Individual command
					if (help.hasOwnProperty(args[0])) {
						if (help[args[0]].admin && !admin) { // Command is admin only and user is not an admin
							message.author.send(embeds.error("Don't ask questions you aren't prepared to handle the asnwers to."))
								.then(log.error)
							break
						} else {
							embed.addField(args[0], help[args[0]].desc + "\n" + help[args[0]].syntax)
						}
					// All commands
					} else {
						for (const [command, properties] of Object.entries(help)) {
							if (!(properties.admin && !admin)) // If the user is not an admin, do not show admin-only commands
								embed.addField(command, properties.desc + "\n" + properties.syntax)
						}
					}
					message.author.send(embed) // DM the user the help embed instead of putting it in chat since it's kinda big
						.then(log.embed)
					break


				case "scrape":
					if (!admin) {
						message.channel.send(embeds.error("You aren't allowed to use this command."))
							.then(log.error)
						break
					}
					const channel = (args[0].toLowerCase() === "here")
						? message.channel
						: client.channels.get(args[0])

					if (!channel) {
						message.channel.send(embeds.error(`Channel not accessible: ${args[0]}`))
							.then(log.error)
						break
					}

					const howManyMessages = (args[1].toLowerCase() === "all")
						? "Infinity" // lol
						: parseInt(args[1])
				
					if (isNaN(howManyMessages)) {
						message.channel.send(embeds.error(`Not a number: ${args[1]}`))
							.then(log.error)
						break
					}

					// Resolve a starting message and a promise for an ending message
					message.channel.send(embeds.standard(`Scraping ${howManyMessages} messages from [${channel.guild.name} - #${channel.name}]...`))
						.then(log.embed)
		
					scrape(channel, howManyMessages)
						.then(messagesAdded => {
							message.channel.send(embeds.standard(`Added ${messagesAdded} messages.`))
								.then(log.embed)
						})
						.catch(err => {
							message.channel.send(embeds.error(err))
								.then(log.error)
						})
					break

				case "imitate":
					let userId

					if (args[0]) {
						// If arg is "me", use the sender's own ID
						// Else, try to find a user ID from a mention
						// If there turns out there is no mention, use a random ID instead
						userId = (args[0].toLowerCase() === "me")
							? message.author.id
							: mentionToUserId(args[0]) || randomUserId()
					} else {
						userId = randomUserId()
					}

					if (userId === client.user.id) { // Bipolar can't imitate herself
						message.channel.send(embeds.xok)
							.then(log.xok)
						break
					}

					generateQuote(userId).then(sentence => {
						message.channel.send(embeds.imitate(userId, sentence, message.channel))
							.then(log.imitate)
					})
					break

				case "embed":
					if (!admin || !args[0]) break
					message.channel.send(embeds.standard(args.join(" ")))
						.then(log.say)
					break

				case "error":
					if (!admin || !args[0]) break
					message.channel.send(embeds.error(args.join(" ")))
						.then(log.error)
					break

				case "xok":
					if (!admin) break
					message.channel.send(embeds.xok)
						.then(log.xok)
					break

				case "save":
					if (!admin) break
					if (unsavedCache.length === 0) {
						message.channel.send(embeds.error("Nothing to save."))
							.then(log.error)
						break
					}
					message.channel.send(embeds.standard("Saving..."))
					saveCache().then(savedCount => {
						message.channel.send(embeds.standard(`Saved ${savedCount} ${(savedCount === 1) ? "corpus" : "corpi"}.`))
							.then(log.say)
					})
					break

				case "filter":
					if (!admin) break
					filterUndefineds(args).then(found => {
						userTable(found).then(table => {
							console.info("Users filtered:")
							console.table(table)
						})
						.catch(console.warn)
						message.channel.send(embed.standard(`Found and removed the word "undefined" from the beginnings of ${found.length} corpi. See the logs for a list of affected users (unless you disabled logs; then you just don't get to know).`))
							.then(log.say)
					})
			}
			resolve(command)

		} catch (err) {
			reject(err)
		}
		
	})
}


/**
 * Sets the custom nicknames from the config file
 * 
 * @return {Promise<void>} Resolve: nothing (there were no errors); Reject: nothing (there was an error)
 */
function updateNicknames(nicknameDict) {
	return new Promise ( (resolve, reject) => {
		var erred = false

		for (const serverName in nicknameDict) {
			const [ serverId, nickname ] = nicknameDict[serverName]
			const server = client.guilds.get(serverId)
			if (!server) {
				console.warn(`Nickname configured for a server that Bipolar is not in. Nickname could not be set in ${serverName} (${serverId}).`)
				continue
			}
			server.me.setNickname(nickname)
				.catch(err => {
					erred = true
					logError(err)
				})
		}

		(erred) ? reject() : resolve()

	})
}


/**
 * Downloads a file from S3_BUCKET_NAME.
 * 
 * @param {string} userId - ID of corpus to download from the S3 bucket
 * @return {Promise<Buffer|Error>} Resolve: Buffer from bucket; Reject: error
 */
function s3read(userId) {
	return new Promise( (resolve, reject) => {
		const params = {
			Bucket: process.env.S3_BUCKET_NAME, 
			Key: `${config.CORPUS_DIR}/${userId}.txt`
		}
		s3.getObject(params, (err, data) => {
			if (err) return reject(err)

			if (data.Body === undefined || data.Body === null)
				return reject(`Empty response at path: ${path}`)

			resolve(data.Body.toString()) // Convert Buffer to string
		})
	})
}


/**
 * Uploads (and overwrites) a corpus in S3_BUCKET_NAME.
 * 
 * @param {string} userId - user ID's corpus to upload/overwrite
 * @return {Promise<Object|Error>} Resolve: success response; Reject: Error
 */
function s3write(userId, data) {
	return new Promise( (resolve, reject) => {
		const params = {
			Bucket: process.env.S3_BUCKET_NAME,
			Key: `${config.CORPUS_DIR}/${userId}.txt`,
			Body: Buffer.from(data, "UTF-8")
		}
		s3.upload(params, (err, res) => {
			(err) ? reject(err) : resolve(res)
		})
	})
}


/**
 * Compiles a list of all the IDs inside 
 */
function s3listUserIds() {
	return new Promise( (resolve, reject) => {
		const params = {
			Bucket: process.env.S3_BUCKET_NAME,
			Prefix: config.CORPUS_DIR,
		}
		s3.listObjectsV2(params, (err, res) => {
			if (err) return reject(err)
			res = res.Contents.map( ({ Key }) => {
				return path.basename(Key.replace(/\.[^/.]+$/, "")) // Remove file extension and preceding path
			})
			resolve(res)
		})
	})
}


/**
 * Uploads all unsaved cache to S3
 *   and empties the list of unsaved files.
 * 
 * @return {Promise<void|Error>} Resolve: nothing; Reject: s3write() error
 */
function saveCache() {
	return new Promise( (resolve, reject) => {
		let savedCount = 0
		let operations = 0
		while (unsavedCache.length > 0) {
			operations++
			const userId = unsavedCache.pop()
			loadCorpus(userId).then(corpus => {
				s3write(userId, corpus)
					.then( () => {
						savedCount++
						operations--
					})
					.catch(reject)
			})
		}

		const whenDone = setInterval( () => {
			if (operations === 0) {
				clearInterval(whenDone)
				resolve(savedCount)
			}
		}, 100)
	})
}


/**
 * Make directory if it doesn't exist
 *
 * @param {string} dir - Directory of which to ensure existence
 * @return {Promise<string|Error>} Directory if it already exists or was successfully made; error if something goes wrong
 */
function ensureDirectory(dir) {
	return new Promise ( (resolve, reject) => {
		fs.stat(dir, err => {
			if (err && err.code === "ENOENT") {
				fs.mkdir(dir, { recursive: true }, err => {
					(err) ? reject(err) : resolve(dir)
				})
			} else if (err)
				return reject(err)
			resolve(dir)
		})
	})
}


/**
 * Try to load the corpus corresponding to [userId] from cache.
 * If the corpus isn't in cache, try to download it from S3.
 * If it isn't there either, give up.
 * 
 * @param {string} userId - user ID whose corpus to load
 * @return {Promise<corpus|Error>} Resolve: [userId]'s corpus; Reject: Error
 */
function loadCorpus(userId) {
	return new Promise( (resolve, reject) => {
		cacheRead(userId) // Maybe the user's corpus is in cache
			.then(resolve)
			.catch(err => {
				if (err.code !== "ENOENT") // Only proceed if the reason cacheRead() failed was
					return reject(err) // because it couldn't find the file

				s3read(userId).then(corpus => { // Maybe the user's corpus is in the S3 bucket
					cacheWrite(userId, corpus)
					resolve(corpus)
				})
				.catch(reject) // User is nowhere to be found (or something went wrong)
			})
	})
}


/**
 * Add data to a user's corpus.
 * 
 * @param {string} userId - ID of the user whose corpus to add data to
 * @param {string} data - data to add
 * @return {Promise<void|Error} Resolve: nothing; Reject: Error
 */
function appendCorpus(userId, data) {
	return new Promise( (resolve, reject) => {
		if (fs.readdirSync(`./cache`).includes(`${userId}.txt`)) { // Corpus is in cache
			fs.appendFile(`./cache/${userId}.txt`, data, err => { // Append the new data to it
				(err) ? reject(err) : resolve()
			})
		} else {
			if (userIdCache.includes(userId)) {
				s3read(userId) // Download the corpus from S3, add the new data to it, cache it
					.then(corpus => {
						corpus += data
						cacheWrite(userId, corpus)
						resolve(corpus)
					})
			} else {
				cacheWrite(userId, data) // User doesn't exist; make them a new corpus from just the new data
				resolve(data)
			}
		}
	})
}


/**
 * Writes a file to cache.
 * 
 * @param {string} filename - name of file to write to (minus extension)
 * @param {string} data - data to write
 * @return {Promise<void|Error>} Resolve: nothing; Reject: Error
 */
function cacheWrite(filename, data) {
	return new Promise( (resolve, reject) => {
		fs.writeFile(`./cache/${filename}.txt`, data, err => {
			(err) ? reject(err) : resolve()
		})
	})
}


/**
 * Reads a file from cache.
 * 
 * @param {string} filename - name of file to read (minus extension)
 * @return {Promise<string|Error>} Resolve: file's contents; Reject: Error
 */
function cacheRead(filename) {
	return new Promise( (resolve, reject) => {
		fs.readFile(`./cache/${filename}.txt`, "UTF-8", (err, data) => {
			if (err)
				reject(err)
			else if (data === "")
				reject( { code: "ENOENT" } )
			else
				resolve(data)
		})
	})
}


/**
 * 0.05% chance to return true; else false
 * 
 * @return {Boolean} True/false
 */
function blurtChance() {
	return Math.random() * 100 <= 0.05 // 0.05% chance
}


/**
 * Get status name from status code
 * 
 * @param {number} code - status code
 * @return {string} status name
 */
function status(code) {
	return ["Playing", "Streaming", "Listening", "Watching"][code]
}


/**
 * @param {string} mention - a string like "<@1234567891234567>"
 * @return {string} user ID
 */
function mentionToUserId(mention) {
	return (mention.startsWith("<@") && mention.endsWith(">"))
		? mention.slice(
			(mention.charAt(2) === "!")
				? 3
				: 2 // TODO: make this not comically unreadable
			, -1
		)
		: null
}


/**
 * Is [val] in [obj]?
 * 
 * @param {any} val
 * @param {Object} object
 * @return {Boolean} True/false
 */
function has(val, obj) {
	for (const i in obj) {
		if (obj[i] === val)
			return true
	}
	return false
}


function isAdmin(userId) {
	return has(userId, config.ADMINS)
}


function isBanned(userId) {
	return has(userId, config.BANNED)
}


function canSpeakIn(channelId) {
	return has(channelId, config.SPEAKING_CHANNELS)
}


function learningIn(channelId) {
	return has(channelId, config.LEARNING_CHANNELS)
}


/**
 * Is Object [obj] empty?
 * 
 * @param {Object} obj
 * @return {Boolean} empty or not
 */
function isEmpty(obj) {
	for (const key in obj) {
		if (obj.hasOwnProperty(key))
			return false
	}
	return true
}


/**
 * Shortcut to a reusable message location string
 * 
 * @param {Message} message
 * @return {string} - "[Server - #channel]" format string
 */
function location(message) {
	return (message.channel.type == "dm")
		? `[Direct message]`
		: `[${message.guild.name} - #${message.channel.name}]`
}


/**
 * Generates an object containing stats about
 *   all the channels in the given dictionary.
 * 
 * @param {Object} channelDict - Dictionary of channels
 * @return {Promise<Object|Error>} Resolve: Object intended to be console.table'd; Reject: "empty object
 * 
 * @example
 *     channelTable(config.SPEAKING_CHANNELS)
 *         .then(console.table)
 */
function channelTable(channelDict) {
	return new Promise( (resolve, reject) => {
		if (config.DISABLE_LOGS)
			return resolve({})
		
		if (isEmpty(channelDict))
			return reject("No channels are whitelisted.")

		const stats = {}
		for (const i in channelDict) {
			const channelId = channelDict[i]
			const channel = client.channels.get(channelId)
			const stat = {}
			stat["Server"] = channel.guild.name
			stat["Name"] = "#" + channel.name
			stats[channelId] = stat
		}
		resolve(stats)
	})
}


/**
 * Generates an object containing stats about
 *   all the nicknames Bipolar has.
 * 
 * @param {Object} nicknameDict - Dictionary of nicknames
 * @return {Promise<Object|Error>} Resolve: Object intended to be console.table'd; Reject: "empty object"
 * 
 * @example
 *     nicknameTable(config.NICKNAMES)
 *         .then(console.table)
 */
function nicknameTable(nicknameDict) {
	return new Promise( (resolve, reject) => {
		if (config.DISABLE_LOGS)
			return resolve({})
		
		if (isEmpty(nicknameDict))
			return reject("No nicknames defined.")

		const stats = {}
		for (const serverName in nicknameDict) {
			const [ serverId, nickname ] = nicknameDict[serverName]
			const server = client.guilds.get(serverId)
			const stat = {}
			stat["Server"] = server.name
			stat["Intended"] = nickname
			stat["De facto"] = server.me.nickname
			stats[serverId] = stat
		}
		resolve(stats)
	})
}


function userTable(userIds) {
	return new Promise( async (resolve, reject) => {
		if (config.DISABLE_LOGS)
			return resolve({})
		
		if (!userIds || userIds.length === 0)
			return reject("No user IDs defined.")

		// If it's a single value, wrap it in an array
		if (!Array.isArray(userIds)) userIds = [userIds]

		const stats = {}
		for (const userId of userIds) {
			const user = await client.fetchUser(userId)
			const stat = {}
			stat["Username"] = user.tag
			stats[userId] = stat
		}
		resolve(stats)
	})
}


/**
 * DM's garlicOS and logs error
 */
function logError(err) {
	console.error(err)
	const sendThis = (err.message)
		? `ERROR! ${err.message}`
		: `ERROR! ${err}`

	client.fetchUser("206235904644349953") // Yes, I hardcoded my own user ID. I'm sorry.
		.then(me => me.send(sendThis))
		.catch(console.error)
}


function httpsDownload(url) {
	return new Promise( (resolve, reject) => {
		require("https").get(url, res => {
			if (res.statusCode === 200) {
				let rawData = ""
				res.setEncoding("utf8")
				res.on("data", chunk => rawData += chunk)
				res.on("end", () => resolve(rawData))
			} else {
				reject(`Failed to download URL: ${url}`)
			}
		})
	})
}


/**
 * Remove bad words from a phrase
 * 
 * @param {string} phrase - Input string
 * @return {Promise<string|Error>} Resolve: filtered string; Reject: Error
 */
function cleanse(phrase) {
	return new Promise( (resolve, reject) => {
		if (!config.BAD_WORDS) return resolve(phrase)

		let words = phrase.split(" ")
		try {
			words = words.filter(word => { // Remove bad words
				!(config.BAD_WORDS
					.includes(
						word
						.toLowerCase()
						.replace("\n", "")
					)
				)
			})
		} catch (err) {
			reject(err)
		}
		resolve(words.join(" "))
	})
}


// --- /FUNCTIONS -------------------------------------------
