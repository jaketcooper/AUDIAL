import json
import urllib3 # type: ignore
import boto3

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
                'headers': headers,
                'body': json.dumps({'error': 'Invalid token'})
            }
        
        user_data = json.loads(response.data.decode('utf-8'))
        
        # Get Cognito token using GetOpenIdTokenForDeveloperIdentity
        cognito = boto3.client('cognito-identity')
        cognito_response = cognito.get_open_id_token_for_developer_identity(
            IdentityPoolId='us-east-1:a60cbe36-1c4f-44bb-a06c-c9c34be2713e',
            Logins={
                'accounts.spotify.com': user_data['id']  # Use Spotify user ID as the identifier
            },
            TokenDuration=3600  # 1 hour
        )
        print("Cognito response:", cognito_response)
        cognito_credentials = cognito.get_credentials_for_identity(
            IdentityId=cognito_response['IdentityId'],
            Logins={
                'cognito-identity.amazonaws.com': cognito_response['Token']
            }
        )
        cognito_credentials['Credentials']['Expiration'] = cognito_credentials['Credentials']['Expiration'].isoformat()
        print("Cognito credentials:", cognito_credentials)
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'userId': user_data['id'],
                'token': spotify_token,  # Keep original Spotify token
                'credentials': cognito_credentials['Credentials'],
                'cognitoToken': cognito_response['Token'],
                'identityId': cognito_credentials['IdentityId'],
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