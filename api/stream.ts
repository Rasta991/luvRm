export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { tmdbId, type = 'movie', season = '1', episode = '1' } = req.query;

  if (!tmdbId) {
    return res.status(400).json({ error: 'Missing tmdbId parameter' });
  }

  try {
    let streamUrl = '';

    if (type === 'movie') {
      streamUrl = `https://vidsrc.cc/v2/embed/movie/${tmdbId}`;
    } else {
      streamUrl = `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${season}/${episode}`;
    }

    return res.status(200).json({
      success: true,
      streamUrl: streamUrl,
      url: streamUrl
    });

  } catch (error: any) {
    return res.status(500).json({ 
      error: 'Failed to resolve stream', 
      details: error.message 
    });
  }
}