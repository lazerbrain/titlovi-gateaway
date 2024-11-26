const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const https = require("https");
const { HttpsProxyAgent } = require("https-proxy-agent");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Konfiguracija za memorijsko keširanje
const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 sat

// Proširena lista User-Agent headera
const userAgents = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
	"Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
];

const getRandomProxy = async () => {
	try {
		// Koristimo besplatni API za proxy liste
		const response = await axios.get(
			"https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps&filterUpTime=90&speed=fast&anonymityLevel=elite"
		);
		const proxies = response.data.data;
		if (proxies && proxies.length > 0) {
			const proxy = proxies[Math.floor(Math.random() * proxies.length)];
			return `http://${proxy.ip}:${proxy.port}`;
		}
		return null;
	} catch (error) {
		console.error("Error fetching proxy:", error);
		return null;
	}
};

const getRandomUserAgent = () =>
	userAgents[Math.floor(Math.random() * userAgents.length)];

// Funkcija za delay između requestova
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Funkcija za kreiranje random IP adrese
const getRandomIP = () => {
	return `${Math.floor(Math.random() * 255)}.${Math.floor(
		Math.random() * 255
	)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
};

// Konfiguracija axiosa sa retry mehanizmom
const createAxiosInstance = async () => {
	const proxy = await getRandomProxy();
	const config = {
		httpsAgent: proxy
			? new HttpsProxyAgent(proxy)
			: new https.Agent({
					rejectUnauthorized: false,
			  }),
		timeout: 15000,
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
	};

	return axios.create(config);
};

// Funkcija za retry mehanizam
const fetchWithRetry = async (url, options = {}, retries = 3) => {
	for (let i = 0; i < retries; i++) {
		try {
			const axiosInstance = await createAxiosInstance();
			const response = await axiosInstance.get(url, options);
			return response;
		} catch (error) {
			console.error(`Attempt ${i + 1} failed:`, error.message);
			if (i === retries - 1) throw error;
			const delayTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
			await delay(delayTime);
		}
	}
};
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
		const imdbResponse = await fetchWithRetry(
			`https://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`
		);
		const searchTitle = imdbResponse.data.Title;

		if (!searchTitle) {
			return res.json([]);
		}

		// Dodajemo random delay između requestova
		await delay(1000 + Math.random() * 2000);

		const searchUrl = `https://titlovi.com/titlovi/?prijevod=${encodeURIComponent(
			searchTitle
		)}&sort=4`;
		console.log("Searching:", searchUrl);

		const response = await fetchWithRetry(searchUrl, {
			headers: {
				Referer: "https://titlovi.com/",
				Host: "titlovi.com",
				Cookie: `ASP.NET_SessionId=${Math.random()
					.toString(36)
					.substring(7)}; _ga=GA1.2.${Math.random()
					.toString()
					.substring(2)}.${Date.now()}`,
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
