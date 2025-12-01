# Order Syncer
This module provides an application based on [commercetools Connect](https://docs.commercetools.com/connect), which receives messages from commercetools project once there is an order created. The corresponding order details are then synchronized to the external tax provider.

The module also provides scripts for post-deployment and pre-undeployment action. After deployment via connect service completed, [commercetools Subscription](https://docs.commercetools.com/api/projects/subscriptions) is created by post-deployment script which listen to any order creation in commercetools Project. Once order has been created, the commercetools Subscription sends message to Google Cloud Pub/Sub topic and then notify the `order-syncer` to handle the corresponding changes.

The commercetools Subscription would be cleared once the tax integration connector is undeployed.

![Payment flow](./docs/images/order-syncer.architecture.png)
## Get started
#### Change the key of commercetools Subscription
Please specify your desired key for creation of commercetools Subscription [here](https://github.com/commercetools/connect-tax-integration-template/blob/dbdce163f08b36d8635d7705dd58c89d03bf8399/order-syncer/src/constants/connectors.constants.js#L3).
The default key is 'ct-connect-tax-integration-order-change-subscription'.

#### Install your tax-provider SDK 
Please run following npm command under `order-syncer` folder to install the NodeJS SDK provided by the tax provider. By default, the (Stripe Node SDK)[https://www.npmjs.com/package/stripe] is included, and for now is the only SDK supported.

```bash
$ npm install <tax-provider-sdk>
```
#### Install dependencies
```bash
$ npm install
```
#### Run unit test
```bash
$ npm run test:unit
```
#### Run integration test
```bash
$ npm run test:integration
```
#### Run the application in local environment
```bash
$ npm run start
```
#### Run post-deploy script in local environment
```bash
$ npm run connector:post-deploy
```
#### Run pre-undeploy script in local environment
```bash
$ npm run connector:pre-undeploy
```

## Development in local environment
Unlike staging and production environments, in which the out-of-the-box setup and variables have been set by the Connect service during deployment, the `order-syncer` requires additional operations in local environment for development.

#### Google Cloud infrastructure.

When an event-type connector application is deployed via the Connect service, a [GCP pub/sub](https://cloud.google.com/pubsub/docs/overview) topic and subscription are created automatically. However, this does not apply on a local environment, such resources will then need to be created manually. Additionally, the developer will have to enable the created subscription to communicate with the locally-running `order-syncer`. This can be achieved by following these steps. 

1. Create a Pub/Sub topic and subscription in Google Cloud platform. 
2. Use HTTP tunnel tools like [ngrok](https://ngrok.com/docs/getting-started) to expose your local development `/orderSyncer` server to the internet.
3. Set the URL provided by the tunnel tool as the destination of the GCP subscription, so that messages can be forwarded to the `order-syncer` in your local environment.

For details, please refer to the [Overview of the GCP Pub/Sub service](https://cloud.google.com/pubsub/docs/pubsub-basics).

#### Google Cloud auth setup

You'll need this one-time auth setup to run the `order-syncer` application locally and test the post-deployment scripts. 


**Step 1: Install Google Cloud SDK**

First, install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) on your local machine

**Step 2: Authenticate and configure your project**

Log in to Google Cloud and set your active project:

```bash
# Authenticate with your Google Cloud account
gcloud auth login

# Set your active project (replace 'your-project-id' with your actual project ID)
gcloud config set project your-project-id
```

**Step 3: Verify your project setup**

Check that you can access your project and list existing topics:

```bash
# List all Pub/Sub topics in your project
gcloud pubsub topics list --project=your-project-id
```

**Step 4: Create a service account**

Create a dedicated service account for the commercetools integration:

```bash
# Create the service account
gcloud iam service-accounts create commercetools-pubsub \
    --display-name="Commercetools Pub/Sub Publisher" \
    --project=your-project-id
```

**Step 5: Grant necessary permissions**

Grant the Pub/Sub publisher role to your service account:

```bash
# Grant publisher permissions
gcloud projects add-iam-policy-binding your-project-id \
    --member="serviceAccount:commercetools-pubsub@your-project-id.iam.gserviceaccount.com" \
    --role="roles/pubsub.publisher"
```

**Step 6: Create and download service account key**

Generate a service account key for authentication:

```bash
# Create and download the service account key
gcloud iam service-accounts keys create commercetools-key.json \
    --iam-account=commercetools-pubsub@your-project-id.iam.gserviceaccount.com \
    --project=your-project-id
```

This will create a JSON key file (`commercetools-key.json`) in your current directory.

**Step 7: Test your setup**

Verify that your Pub/Sub topic is working correctly:

```bash
# Test publishing a message to your topic
gcloud pubsub topics publish ct-stripe-tax-topic \
    --message="Test message from gcloud" \
    --project=your-project-id

# Create a test subscription to verify the topic works
gcloud pubsub subscriptions create test-subscription \
    --topic=ct-stripe-tax-topic \
    --project=your-project-id
```

**Step 8: Configure topic permissions (if needed)**

If you encounter permission errors, you may need to update the topic permissions:

```bash
# Allow all users to publish to the topic (for development only)
gcloud pubsub topics add-iam-policy-binding ct-stripe-tax-topic \
    --member="allUsers" \
    --role="roles/pubsub.publisher" \
    --project=your-project-id
```

**Next steps:**

After completing this setup, you should be able to run the post-deployment script without errors:

```bash
npm run connector:post-deploy
```

Make sure to update your environment variables in the `.env` file with your actual project ID and topic name. See the following section for more details.

#### Required environment variables

Before starting the development, we advise users to create a .env file in order to help them in local development.
      
For that, we also have a template file .env.example with the required environment variables for the project to run successfully. To make it work, rename the file from `.env.example` to `.env`. Remember to fill the variables with your values.

In addition, the following two environment variables in `.env.example` needn't be provided by users during staging or production deployment. 
```
CONNECT_SUBSCRIPTION_TOPIC_NAME=<your-gcp-topic-name>
CONNECT_SUBSCRIPTION_PROJECT_ID=<your-gcp-project-id>
```
Since they're only required in local development servers. For staging or production environments, connect service sets the Pub/Sub topic name and GCP project ID into these environment variables automatically after the Pub/Sub service has been created in Google Cloud platform. 