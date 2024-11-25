import { Amplify } from 'aws-amplify';

Amplify.configure({
  API: {
    endpoints: [
      {
        name: "api6f88271f",
        endpoint: "https://alfbh3l2k4.execute-api.us-east-1.amazonaws.com/dev"
      }
    ]
  }
});