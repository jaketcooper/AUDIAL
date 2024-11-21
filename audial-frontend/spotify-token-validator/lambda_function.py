import json
import urllib3 # type: ignore

def lambda_handler(event, context):
    headers = {}
    
    try:
        body = json.loads(event.get('body', '{}'))
        spotify_token = body.get('token')
        
        if not spotify_token:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'No token provided'})
            }
        
        # Just validate the token with Spotify
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
                'headers': headers,
                'body': json.dumps({'error': 'Invalid token'})
            }
        
        user_data = json.loads(response.data.decode('utf-8'))
        
        # Just return the validated token
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'userId': user_data['id'],
                'token': spotify_token,  # Return the original Spotify token
                'identities': [{
                    'userId': user_data['id'],
                    'providerName': 'accounts.spotify.com'
                }]
            })
        }
        
    except Exception as e:
        print("Error occurred:", str(e))
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': str(e)
            })
        }