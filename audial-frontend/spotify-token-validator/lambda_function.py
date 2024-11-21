import json
import urllib3

def lambda_handler(event, context):
    # Get the Spotify token from the event
    spotify_token = event.get('token')
    
    if not spotify_token:
        return {
            'statusCode': 400,
            'body': json.dumps('No token provided')
        }
    
    # Validate the token with Spotify
    http = urllib3.PoolManager()
    response = http.request(
        'GET',
        'https://api.spotify.com/v1/me',
        headers={
            'Authorization': f'Bearer {spotify_token}'
        }
    )
    
    if response.status != 200:
        return {
            'statusCode': 401,
            'body': json.dumps('Invalid token')
        }
    
    # Get the user info
    user_data = json.loads(response.data.decode('utf-8'))
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'userId': user_data['id'],
            'email': user_data.get('email'),
            'identities': [{
                'userId': user_data['id'],
                'providerName': 'spotify.com'
            }]
        })
    }

