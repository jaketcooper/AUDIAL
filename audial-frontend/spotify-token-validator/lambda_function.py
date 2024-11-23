import json
import urllib3
import boto3
from typing import Dict, Any, Optional
import logging

# Configure logging for CloudWatch
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def create_response(status_code: int, body: Dict[str, Any], headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Create a standardized API response."""
    if headers is None:
        headers = {}
    
    # Only set security headers here, not CORS (handled by Function URL settings)
    headers.update({
        'X-Content-Type-Options': 'nosniff',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
    })
    
    return {
        'statusCode': status_code,
        'headers': headers,
        'body': json.dumps(body)
    }

def validate_spotify_token(token: str) -> Optional[Dict[str, Any]]:
    """Validate Spotify token and return user data."""
    try:
        http = urllib3.PoolManager()
        response = http.request(
            'GET',
            'https://api.spotify.com/v1/me',
            headers={'Authorization': f'Bearer {token}'}
        )
        
        if response.status != 200:
            logger.warning(f"Spotify token validation failed with status: {response.status}")
            return None
            
        return json.loads(response.data.decode('utf-8'))
    except Exception as e:
        logger.error(f"Error validating Spotify token: {type(e).__name__}")
        return None

def get_cognito_tokens(user_id: str) -> Optional[Dict[str, Any]]:
    """Get Cognito tokens for the user."""
    try:
        cognito = boto3.client('cognito-identity')
        
        # Get OpenID token
        cognito_response = cognito.get_open_id_token_for_developer_identity(
            IdentityPoolId='us-east-1:a60cbe36-1c4f-44bb-a06c-c9c34be2713e',
            Logins={
                'accounts.spotify.com': user_id
            },
            TokenDuration=3600
        )
        
        # Get credentials for identity
        credentials = cognito.get_credentials_for_identity(
            IdentityId=cognito_response['IdentityId'],
            Logins={
                'cognito-identity.amazonaws.com': cognito_response['Token']
            }
        )
        
        return {
            'identityId': cognito_response['IdentityId'],
            'token': cognito_response['Token'],
            'credentials': {
                'accessKeyId': credentials['Credentials']['AccessKeyId'],
                'secretKey': credentials['Credentials']['SecretKey'],
                'sessionToken': credentials['Credentials']['SessionToken'],
                'expiration': credentials['Credentials']['Expiration'].isoformat()
            }
        }
    except Exception as e:
        logger.error(f"Error getting Cognito tokens: {type(e).__name__}")
        return None

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Handle Lambda function invocation."""
    # OPTIONS requests are now handled by Lambda Function URL configuration
    try:
        # Parse and validate input
        body = json.loads(event.get('body', '{}'))
        spotify_token = body.get('token')
        
        if not spotify_token:
            logger.warning("No token provided in request")
            return create_response(400, {'error': 'No token provided'})
        
        # Validate Spotify token
        user_data = validate_spotify_token(spotify_token)
        if not user_data:
            return create_response(401, {'error': 'Invalid token'})
        
        # Get Cognito tokens
        cognito_data = get_cognito_tokens(user_data['id'])
        if not cognito_data:
            return create_response(500, {'error': 'Failed to obtain authentication credentials'})
        
        # Log successful authentication (without sensitive data)
        logger.info(f"Successfully authenticated user: {user_data['id']}")
        
        # Return success response
        return create_response(200, {
            'userId': user_data['id'],
            'token': spotify_token,
            'identityId': cognito_data['identityId'],
            'cognitoToken': cognito_data['token'],
            'credentials': cognito_data['credentials']
        })
        
    except json.JSONDecodeError:
        logger.error("Invalid JSON in request body")
        return create_response(400, {'error': 'Invalid request format'})
        
    except Exception as e:
        logger.error(f"Unexpected error: {type(e).__name__}")
        return create_response(500, {'error': 'Internal server error'})