<?php

namespace AppBundle\Edenred;

use AppBundle\Entity\Sylius\Customer;
use AppBundle\Sylius\Customer\CustomerInterface;
use AppBundle\Sylius\Order\AdjustmentInterface;
use AppBundle\Sylius\Order\OrderInterface;
use GuzzleHttp\Client as BaseClient;
use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Promise\RejectedPromise;
use GuzzleHttp\Psr7;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Webmozart\Assert\Assert;

class Client extends BaseClient
{
    private $logger;

    public function __construct(
        array $config = [],
        string $paymentClientId,
        string $paymentClientSecret,
        RefreshTokenHandler $refreshTokenHandler,
        Authentication $authentication,
        LoggerInterface $logger)
    {
        $stack = HandlerStack::create();
        $stack->push($refreshTokenHandler);

        $config['handler'] = $stack;

        parent::__construct($config);

        $this->paymentClientId = $paymentClientId;
        $this->paymentClientSecret = $paymentClientSecret;
        $this->authentication = $authentication;

        $this->logger = $logger ?? new NullLogger();
    }

    public function getBalance(Customer $customer): int
    {
        $userInfo = $this->authentication->userInfo($customer);

        $credentials = $customer->getEdenredCredentials();

        // https://documenter.getpostman.com/view/10405248/TVewaQQX#82e953fc-9110-4246-8a78-aba888b70b31
        $response = $this->request('GET', sprintf('/v1/users/%s', $userInfo['username']), [
            'headers' => [
                'Authorization' => sprintf('Bearer %s', $credentials->getAccessToken()),
                'X-Client-Id' => $this->paymentClientId,
                'X-Client-Secret' => $this->paymentClientSecret,
            ],
            'oauth_credentials' => $credentials,
        ]);

        $data = json_decode((string) $response->getBody(), true);

        return $data['data']['available_amount'] ?? 0;
    }

    public function authorizeTransaction(OrderInterface $order): array
    {
        $body = [
            "mid" => $order->getVendor()->getEdenredMerchantId(),
            "order_ref" => $order->getNumber(),
            "amount" => 2,
            "capture_mode" => "manual",
            "tstamp" => (new \DateTime())->format(\DateTime::ATOM),
        ];

        Assert::isInstanceOf($order->getCustomer(), CustomerInterface::class);

        $credentials = $order->getCustomer()->getEdenredCredentials();

        // https://documenter.getpostman.com/view/10405248/TVewaQQX#42a5e69d-898b-41b9-b37e-9d28c23135c8
        try {

            $response = $this->request('POST', '/v1/transactions', [
                'headers' => [
                    'Authorization' => sprintf('Bearer %s', $credentials->getAccessToken()),
                    'X-Client-Id' => $this->paymentClientId,
                    'X-Client-Secret' => $this->paymentClientSecret,
                ],
                'json' => $body,
                'oauth_credentials' => $credentials,
            ]);

            return json_decode((string) $response->getBody(), true);

        } catch (RequestException $e) {

            $this->logger->error(sprintf('Could not authorize transaction: "%s"',
                (string) $e->getResponse()->getBody()));

            throw $e;
        }
    }

    public function splitAmounts(OrderInterface $order)
    {
        $total = $order->getTotal();

        $deliveryFee = $order->getAdjustmentsTotal(AdjustmentInterface::DELIVERY_ADJUSTMENT);
        $packagingFee = $order->getAdjustmentsTotal(AdjustmentInterface::REUSABLE_PACKAGING_ADJUSTMENT);

        $notPayableAmount = $deliveryFee + $packagingFee;
        $payableAmount = $total - $notPayableAmount;

        $balance = $this->getBalance($order->getCustomer());

        if ($payableAmount > $balance) {
            $rest = $payableAmount - $balance;
            $notPayableAmount += $rest;
            $payableAmount = $balance;
        }

        return [
            'edenred' => $payableAmount,
            'stripe' => $notPayableAmount,
        ];
    }
}
