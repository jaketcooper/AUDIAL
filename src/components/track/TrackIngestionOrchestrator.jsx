import React, { useState, useEffect } from 'react';
import { useAuth } from './auth/AuthProvider';
import { Alert, AlertDescription } from '@/components/ui/alert';

const BATCH_SIZE = 50; // Match Lambda batch size from legacy implementation

const TrackIngestionOrchestrator = () => {
    const { spotifyToken, credentials } = useAuth();
    const [status, setStatus] = useState('idle');
    const [progress, setProgress] = useState({ processed: 0, total: 0 });
    const [error, setError] = useState(null);

    const fetchStoredTrackIds = async () => {
        try {
            const response = await fetch('https://your-api-endpoint/tracks', {
                headers: {
                    'Authorization': `Bearer ${credentials.sessionToken}`
                }
            });
            const data = await response.json();
            return new Set(data.trackIds);
        } catch (err) {
            throw new Error('Failed to fetch stored track IDs');
        }
    };

    const fetchUserPlaylists = async () => {
        const playlists = new Set();
        let offset = 0;

        while (true) {
            const response = await fetch(
                `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`,
                {
                    headers: {
                        'Authorization': `Bearer ${spotifyToken}`
                    }
                }
            );
            const data = await response.json();

            if (!data.items.length) break;

            data.items.forEach(playlist => playlists.add(playlist.id));
            offset += data.items.length;

            if (data.items.length < 50) break;
        }

        return Array.from(playlists);
    };

    const getPlaylistTracks = async (playlistId) => {
        const tracks = new Set();
        let offset = 0;

        while (true) {
            const response = await fetch(
                `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=items(track(id))&offset=${offset}`,
                {
                    headers: {
                        'Authorization': `Bearer ${spotifyToken}`
                    }
                }
            );
            const data = await response.json();

            if (!data.items.length) break;

            data.items.forEach(item => {
                if (item.track && item.track.id) {
                    tracks.add(item.track.id);
                }
            });

            offset += data.items.length;
            if (data.items.length < 100) break;
        }

        return tracks;
    };

    const analyzeTracks = async (trackIds) => {
        for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
            const batch = trackIds.slice(i, i + BATCH_SIZE);

            try {
                await fetch('https://your-lambda-url/analyze-tracks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${credentials.sessionToken}`
                    },
                    body: JSON.stringify({
                        trackIds: batch,
                        spotifyCredentials: {
                            token: spotifyToken
                        }
                    })
                });

                setProgress(prev => ({
                    ...prev,
                    processed: prev.processed + batch.length
                }));
            } catch (err) {
                console.error(`Failed to process batch starting at index ${i}:`, err);
                // Continue with next batch despite errors
            }
        }
    };

    const startIngestion = async () => {
        try {
            setStatus('running');
            setError(null);
            setProgress({ processed: 0, total: 0 });

            // Get existing tracks
            const storedTracks = await fetchStoredTrackIds();

            // Get user's playlists
            const playlists = await fetchUserPlaylists();

            // Get all unique tracks from playlists
            const allTracks = new Set();
            for (const playlistId of playlists) {
                const playlistTracks = await getPlaylistTracks(playlistId);
                playlistTracks.forEach(track => allTracks.add(track));
            }

            // Filter out already analyzed tracks
            const tracksToAnalyze = Array.from(allTracks)
                .filter(trackId => !storedTracks.has(trackId));

            setProgress(prev => ({ ...prev, total: tracksToAnalyze.length }));

            if (tracksToAnalyze.length === 0) {
                setStatus('complete');
                return;
            }

            // Process tracks in batches
            await analyzeTracks(tracksToAnalyze);
            setStatus('complete');

        } catch (err) {
            setError(err.message);
            setStatus('error');
        }
    };

    // Auto-start when component mounts
    useEffect(() => {
        if (spotifyToken && credentials) {
            startIngestion();
        }
    }, [spotifyToken, credentials]);

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    Failed to analyze tracks: {error}
                </AlertDescription>
            </Alert>
        );
    }

    if (status === 'complete') {
        return (
            <Alert>
                <AlertDescription>
                    Track analysis complete. Processed {progress.processed} tracks.
                </AlertDescription>
            </Alert>
        );
    }

    if (status === 'running') {
        return (
            <Alert>
                <AlertDescription>
                    Analyzing tracks... {progress.processed} of {progress.total}
                </AlertDescription>
            </Alert>
        );
    }

    return null;
};

export default TrackIngestionOrchestrator;