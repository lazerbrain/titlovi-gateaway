const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const https = require("https");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Konfiguracija za memorijsko keširanje
const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 sat

// Rotacija User-Agent headera
const userAgents = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

const getRandomUserAgent = () =>
	userAgents[Math.floor(Math.random() * userAgents.length)];

const axiosInstance = axios.create({
	httpsAgent: new https.Agent({
		rejectUnauthorized: false,
	}),
	timeout: 10000, // Povećan timeout na 10 sekundi
	headers: {
		Accept:
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9,hr;q=0.8,sr;q=0.7",
		"Accept-Encoding": "gzip, deflate, br",
		Connection: "keep-alive",
		"Cache-Control": "no-cache",
		Pragma: "no-cache",
		"Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120"',
		"Sec-Ch-Ua-Mobile": "?0",
		"Sec-Ch-Ua-Platform": '"Windows"',
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		"Upgrade-Insecure-Requests": "1",
		"User-Agent": getRandomUserAgent(),
	},
});

app.get("/search/:token/:imdbId/:type/:langs", async (req, res) => {
	try {
		const { imdbId, type, langs } = req.params;
		const requestedLangs = langs.split("|");

		// Check cache
		const cacheKey = `${imdbId}-${langs}`;
		const cachedData = cache.get(cacheKey);
		if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
			return res.json(cachedData.data);
		}

		console.log(`Searching for: ${imdbId} (${type})`);

		// OMDB API call
		const imdbResponse = await axiosInstance.get(
			`https://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`
		);
		const searchTitle = imdbResponse.data.Title;

		if (!searchTitle) {
			return res.json([]);
		}

		const searchUrl = `https://titlovi.com/titlovi/?prijevod=${encodeURIComponent(
			searchTitle
		)}&sort=4`;
		console.log("Searching:", searchUrl);

		// New request with fresh headers
		const response = await axiosInstance.get(searchUrl, {
			headers: {
				...axiosInstance.defaults.headers,
				"User-Agent": getRandomUserAgent(),
				Referer: "https://titlovi.com/",
				Cookie: "ASP.NET_SessionId=abc123; _ga=GA1.2.123.123",
				Host: "titlovi.com",
			},
		});

		console.log("Response status:", response.status);

		const $ = cheerio.load(response.data);
		const subtitles = [];

		$("ul.titlovi > li.subtitleContainer").each((_, elem) => {
			const $elem = $(elem);
			const langImg = $elem.find("img.lang");
			const langAlt = langImg.attr("alt");

			const langMap = {
				3: "English",
				4: "Hrvatski",
				5: "Makedonski",
				6: "Slovenski",
				7: "Srpski",
			};

			const lang = langMap[langAlt];

			if (requestedLangs.includes(lang)) {
				const title = $elem.find("h3 a").text().trim();
				const downloadLink = $elem.find(".download a").attr("href");
				const fps = $elem.find("span.fps").text().replace("fps: ", "").trim();
				const downloads = $elem.find("span.downloads").text().trim();

				if (downloadLink) {
					subtitles.push({
						id: downloadLink.split("-").pop().replace("/", ""),
						link_srt: `https://titlovi.com${downloadLink}`,
						lang,
						title,
						fps: fps !== "N/A" ? fps : null,
						downloads: parseInt(downloads) || 0,
					});
				}
			}
		});

		// Cache results
		cache.set(cacheKey, {
			data: subtitles,
			timestamp: Date.now(),
		});

		console.log(`Found ${subtitles.length} subtitles`);
		res.json(subtitles);
	} catch (error) {
		console.error(
			"Error details:",
			error.response
				? {
						status: error.response.status,
						statusText: error.response.statusText,
						headers: error.response.headers,
				  }
				: error
		);

		res.status(500).json({
			error: "Failed to fetch subtitles",
			message: error.message,
			details: error.response ? error.response.data : null,
		});
	}
});

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({
		status: "ok",
		timestamp: new Date().toISOString(),
	});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
