# Architecture diagram, drawn with https://diagrams.mingrammer.com
# Regenerate (writes docs/architecture.png):
#   docker run --rm -v "$PWD/docs:/docs" -w /docs python:3.12-slim sh -c \
#     "apt-get update -qq && apt-get install -y -qq graphviz >/dev/null && pip install -q diagrams && python architecture.py"
from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.general import Client
from diagrams.aws.integration import Appsync
from diagrams.aws.network import APIGateway
from diagrams.aws.security import Cognito

# curved edges keep the labels on their edges (the default orthogonal edges don't)
# newrank lays out columns across cluster boundaries, so both APIs share a column
graph_attr = {"pad": "0.5", "nodesep": "0.8", "ranksep": "1.6", "fontsize": "20", "splines": "spline",
              "newrank": "true"}
node_attr = {"fontsize": "13"}
edge_attr = {"fontsize": "11"}

with Diagram("Serverless chat with AppSync Events and Cognito", filename="architecture", show=False,
             direction="LR", graph_attr=graph_attr, node_attr=node_attr, edge_attr=edge_attr):
    browser = Client("Browser\nchat-ui + auth.js")

    with Cluster("AWS"):
        # declaration order sets the top-to-bottom order: Event API, Cognito, REST API
        event_api = Appsync("AppSync Event API\nonSubscribe / onPublish")

        cognito = Cognito("Cognito user pool\nmanaged login")

        with Cluster("REST API"):
            rest_api = APIGateway("API Gateway\nCognito authorizer")
            list_channels = Lambda("GET /channels")
            get_messages = Lambda("GET /channels/{channel}\n/messages")

        with Cluster("DynamoDB"):
            memberships = Dynamodb("memberships\nchannel + userId (sub)")
            messages = Dynamodb("messages\nchannel + id")

    # the weight keeps the Event API in the same column as Cognito and API Gateway
    browser >> Edge(label="WebSocket + HTTP publish\nID token", weight="10") >> event_api
    browser >> Edge(label="sign in: code + PKCE") >> cognito
    browser >> Edge(label="REST\nID token") >> rest_api

    # constraint=false keeps Cognito in the same column as the two APIs
    event_api >> Edge(style="dashed", color="gray", label="verify token", constraint="false") >> cognito
    rest_api >> Edge(style="dashed", color="gray", label="verify token", constraint="false") >> cognito

    rest_api >> list_channels
    rest_api >> get_messages

    event_api >> Edge(label="membership check") >> memberships
    event_api >> Edge(label="save messages\n(same transaction)") >> messages
    list_channels >> Edge(label="my channels") >> memberships
    get_messages >> Edge(label="membership check") >> memberships
    # no label: it would sit on the crossing with the Event API's membership check
    get_messages >> messages
