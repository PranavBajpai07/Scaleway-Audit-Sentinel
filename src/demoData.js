const demoUsers = [
  "alice",
  "bob",
  "charlie",
  "dina",
  "erik",
  "fatima",
  "gaurav",
  "hana",
  "ivan",
  "julia",
  "kiran",
  "lina"
];

const unusualCountries = ["RU", "CN", "BR", "US", "ZA", "AE", "JP", "KR", "MX", "NG"];
const credentialMethods = ["CreateAPIKey", "DeleteAPIKey", "UpdateAPIKey", "CreateToken", "DeleteToken", "UpdateMFA"];

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function pad(value) {
  return String(value).padStart(3, "0");
}

function userId(name) {
  return `user-${name}`;
}

function userEmail(name) {
  return `${name}@example.com`;
}

function accountUserResource(name) {
  return {
    id: userId(name),
    type: "account_user",
    account_user_info: { email: userEmail(name) }
  };
}

export class DemoScalewayClient {
  constructor() {
    this.lockedUsers = new Set();
  }

  async listAuditEvents() {
    return [
      ...baseAuditEvents(),
      ...generatedForbiddenSecretEvents(),
      ...generatedCredentialEvents()
    ];
  }

  async listAuthenticationEvents() {
    return [
      ...baseAuthenticationEvents(),
      ...generatedFailedLoginBursts(),
      ...generatedUnusualCountryLogins()
    ];
  }

  async lockUser(userId) {
    this.lockedUsers.add(userId);
    return { id: userId, locked: true };
  }

  async unlockUser(userId) {
    this.lockedUsers.delete(userId);
    return { id: userId, locked: false };
  }
}

function baseAuditEvents() {
  return [
    {
      id: "audit-001",
      recorded_at: minutesAgo(24),
      principal: { id: "user-alice" },
      source_ip: "203.0.113.14",
      product_name: "iam",
      service_name: "IAM",
      method_name: "CreateAPIKey",
      status_code: 200,
      resources: [
        { id: "key-prod-1", type: "iam_api_key", name: "prod-deploy-key" }
      ]
    },
    {
      id: "audit-002",
      recorded_at: minutesAgo(20),
      principal: { id: "user-bob" },
      source_ip: "198.51.100.80",
      product_name: "secret-manager",
      service_name: "SecretManager",
      method_name: "ListSecrets",
      status_code: 403,
      resources: [
        { id: "secret-payments", type: "secret_manager_secret", name: "payments/prod" }
      ]
    },
    {
      id: "audit-003",
      recorded_at: minutesAgo(7),
      principal: { id: "user-ci-bot" },
      source_ip: "192.0.2.25",
      product_name: "iam",
      service_name: "IAM",
      method_name: "DeleteAPIKey",
      status_code: 200,
      resources: [
        { id: "key-old", type: "iam_api_key", name: "old-automation-key" }
      ]
    }
  ];
}

function generatedForbiddenSecretEvents() {
  return Array.from({ length: 48 }, (_, index) => {
    const number = index + 1;
    const name = demoUsers[index % demoUsers.length];
    return {
      id: `audit-secret-${pad(number)}`,
      recorded_at: minutesAgo(58 - (index % 55)),
      principal: { id: userId(name) },
      source_ip: `198.51.100.${20 + (index % 70)}`,
      product_name: "secret-manager",
      service_name: "SecretManager",
      method_name: index % 2 === 0 ? "GetSecretVersion" : "ListSecrets",
      status_code: 403,
      resources: [
        {
          id: `secret-${pad(number)}`,
          type: "secret_manager_secret",
          name: `prod/service-${pad(number)}`
        }
      ]
    };
  });
}

function generatedCredentialEvents() {
  return Array.from({ length: 45 }, (_, index) => {
    const number = index + 1;
    const name = demoUsers[(index + 3) % demoUsers.length];
    const methodName = credentialMethods[index % credentialMethods.length];
    return {
      id: `audit-credential-${pad(number)}`,
      recorded_at: minutesAgo(55 - (index % 50)),
      principal: { id: userId(name) },
      source_ip: `203.0.113.${30 + (index % 80)}`,
      product_name: "iam",
      service_name: "IAM",
      method_name: methodName,
      status_code: 200,
      resources: [
        {
          id: `credential-${pad(number)}`,
          type: methodName.toLowerCase().includes("mfa") ? "iam_mfa_device" : "iam_api_key",
          name: `${methodName.toLowerCase()}-${pad(number)}`
        }
      ]
    };
  });
}

function baseAuthenticationEvents() {
  return [
    {
      id: "auth-001",
      recorded_at: minutesAgo(14),
      source_ip: "198.51.100.44",
      result: "failure",
      failure_reason: "invalid_password",
      country_code: "FR",
      method: "password",
      origin: "console",
      resources: [accountUserResource("bob")]
    },
    {
      id: "auth-002",
      recorded_at: minutesAgo(12),
      source_ip: "198.51.100.44",
      result: "failure",
      failure_reason: "invalid_password",
      country_code: "FR",
      method: "password",
      origin: "console",
      resources: [accountUserResource("bob")]
    },
    {
      id: "auth-003",
      recorded_at: minutesAgo(10),
      source_ip: "198.51.100.44",
      result: "failure",
      failure_reason: "invalid_password",
      country_code: "FR",
      method: "password",
      origin: "console",
      resources: [accountUserResource("bob")]
    },
    {
      id: "auth-004",
      recorded_at: minutesAgo(5),
      source_ip: "203.0.113.77",
      result: "success",
      failure_reason: "",
      country_code: "RU",
      method: "password",
      origin: "console",
      resources: [accountUserResource("alice")]
    }
  ];
}

function generatedFailedLoginBursts() {
  return demoUsers.flatMap((name, userIndex) => {
    return [0, 1, 2].map((attemptIndex) => ({
      id: `auth-fail-${name}-${attemptIndex + 1}`,
      recorded_at: minutesAgo(50 - userIndex * 2 - attemptIndex),
      source_ip: `198.51.100.${100 + userIndex}`,
      result: "failure",
      failure_reason: attemptIndex === 2 ? "mfa_challenge_failed" : "invalid_password",
      country_code: userIndex % 2 === 0 ? "FR" : "IN",
      method: "password",
      origin: "console",
      resources: [accountUserResource(name)]
    }));
  });
}

function generatedUnusualCountryLogins() {
  return Array.from({ length: 40 }, (_, index) => {
    const number = index + 1;
    const name = demoUsers[(index + 5) % demoUsers.length];
    return {
      id: `auth-unusual-${pad(number)}`,
      recorded_at: minutesAgo(45 - (index % 40)),
      source_ip: `203.0.113.${90 + (index % 90)}`,
      result: "success",
      failure_reason: "",
      country_code: unusualCountries[index % unusualCountries.length],
      method: index % 3 === 0 ? "api_key" : "password",
      origin: index % 4 === 0 ? "api" : "console",
      resources: [accountUserResource(name)]
    };
  });
}