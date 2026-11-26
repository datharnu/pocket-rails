// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice EIP-3009 (USDC-style) signed transfers. tUSD8 on Aevum implements this.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title PocketRails
/// @notice Family vaults in one stablecoin. A parent sets standing rules once; a child pays inside them
///         without asking; a school bills inside a capped, expiring permission with a veto window.
///         Every decision (paid, refused, requested, allowed, vetoed, settled, revoked) is an event.
///
/// @dev Design rules this contract keeps:
///      - The contract is the only guard. No owner, no admin, no upgrade path. Only a vault's parent
///        can widen anything in that vault.
///      - Child payments are EIP-712 intents bound to this chain, this contract, the vault, a nonce,
///        a deadline and the child's access epoch. Anyone (a relayer, the child) can submit them.
///      - A signed intent that breaks a rule does NOT revert: it consumes the nonce, moves no money and
///        emits `Refused` with a reason code, so a refusal has a transaction hash like a payment does.
///        Problems with the signature itself (bad signer, replay, expired deadline) revert.
///      - A guardian (for example an AI agent's key) can only veto school charges. It can never approve,
///        raise a limit or move money. "AI can say no, never yes."
///      - Memos are stored as hashes only. Keep the text off-chain.
///      - A parent can earmark part of the balance for school charges: child payments can't touch it.
///      - Revoking bumps an epoch, so every pending exception, unsubmitted intent and billing permission
///        tied to the old epoch dies in O(1).
contract PocketRails is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    /// @notice Why something was refused. Stable numbers: the app maps them to plain language.
    enum Reason {
        None, //                0
        AccessRevoked, //       1 child access is off, or the intent was signed before the last revoke
        AccessExpired, //       2 the vault's access expiry has passed
        PayeeNotApproved, //    3 payee is not on the approved list
        OverPaymentLimit, //    4 amount is above the per-payment limit
        OverWeeklyLimit, //     5 this payment would pass the weekly total
        InsufficientBalance, // 6 the vault doesn't hold enough
        ExceptionNotApproved, // 7 exception is unknown, pending, declined, used, expired or from an old epoch
        ExceptionMismatch, //   8 payee, amount or memo differs from what the parent allowed
        OverChargeLimit, //     9 school charge is above the per-charge cap
        OverPeriodLimit, //    10 school charge would pass the per-period cap
        BillingExpired, //     11 billing permission has expired
        BillingRevoked, //     12 billing permission was revoked (alone, or by revoking the whole vault)
        EarmarkedForSchool //  13 the payment would use money the parent set aside for school charges
    }

    enum ExceptionStatus {
        None,
        Pending,
        Approved,
        Declined,
        Used
    }

    enum ChargeStatus {
        None,
        Pending, //        inside its veto window; settles when the window ends unless vetoed
        AwaitingParent, // first charge on a permission that asks for parent approval
        Vetoed,
        Settled,
        Failed
    }

    struct Rules {
        uint128 perPaymentLimit;
        uint128 weeklyLimit;
        uint64 expiresAt; // child access ends at this time. Required.
    }

    struct Vault {
        address parent;
        address child;
        address guardian; // may veto school charges, nothing else. Optional.
        bool childActive;
        uint64 childEpoch;
        uint64 billingEpoch;
        uint64 version; // bumps on every configuration change
        uint64 week; // week index that `weekSpent` belongs to
        uint256 weekSpent;
        uint256 balance;
        uint256 schoolReserve; // part of `balance` set aside for school charges; child payments can't use it
        Rules rules;
    }

    /// @notice What a child signs to pay. `exceptionId` 0 means "under the standing rules".
    struct Payment {
        uint256 vaultId;
        address payee;
        uint256 amount;
        bytes32 memoHash;
        uint256 exceptionId;
        uint256 nonce;
        uint64 epoch;
        uint64 deadline;
    }

    /// @notice What a child signs to ask for a one-time exception.
    struct ExceptionRequest {
        uint256 vaultId;
        address payee;
        uint256 amount;
        bytes32 memoHash;
        uint256 nonce;
        uint64 epoch;
        uint64 deadline;
    }

    struct Exception {
        uint256 vaultId;
        address payee;
        uint256 amount;
        bytes32 memoHash;
        uint64 epoch;
        uint64 validUntil;
        ExceptionStatus status;
    }

    struct BillingTerms {
        address biller; // key allowed to request charges (e.g. the school's billing agent)
        address payTo; // where settled money goes (e.g. the school's treasury)
        uint128 maxPerCharge;
        uint128 maxPerPeriod;
        uint64 period; // seconds, e.g. 1 days or 30 days
        uint64 expiresAt;
        uint64 vetoWindow; // seconds a charge waits before it can settle
        bool firstChargeNeedsApproval;
    }

    struct Billing {
        uint256 vaultId;
        address biller;
        address payTo;
        uint128 maxPerCharge;
        uint128 maxPerPeriod;
        uint64 period;
        uint64 startAt;
        uint64 expiresAt;
        uint64 vetoWindow;
        uint64 epoch;
        uint64 periodIndex;
        bool revoked;
        bool firstChargeNeedsApproval;
        bool hasSettled;
        uint256 periodUsed; // pending + settled charges in the current period
    }

    /// @notice An EIP-3009 signature split into its parts.
    struct Sig {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Charge {
        uint256 billingId;
        uint256 amount;
        bytes32 memoHash;
        uint64 settleAfter;
        uint64 periodIndex;
        ChargeStatus status;
    }

    // ------------------------------------------------------------------ constants

    bytes32 public constant PAYMENT_TYPEHASH = keccak256(
        "Payment(uint256 vaultId,address payee,uint256 amount,bytes32 memoHash,uint256 exceptionId,uint256 nonce,uint64 epoch,uint64 deadline)"
    );
    bytes32 public constant EXCEPTION_REQUEST_TYPEHASH = keccak256(
        "ExceptionRequest(uint256 vaultId,address payee,uint256 amount,bytes32 memoHash,uint256 nonce,uint64 epoch,uint64 deadline)"
    );

    uint64 public constant MIN_VETO_WINDOW = 1 minutes;
    uint64 public constant MAX_VETO_WINDOW = 30 days;

    // ------------------------------------------------------------------ storage

    IERC20 public immutable token;

    uint256 public vaultCount;
    uint256 public exceptionCount;
    uint256 public billingCount;
    uint256 public chargeCount;

    mapping(uint256 vaultId => Vault) private _vaults;
    mapping(uint256 vaultId => mapping(address payee => bool)) public isApprovedPayee;
    mapping(uint256 vaultId => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(uint256 exceptionId => Exception) private _exceptions;
    mapping(uint256 billingId => Billing) private _billings;
    mapping(uint256 chargeId => Charge) private _charges;
    /// @notice When true, a pending charge on this vault can't settle until the guardian has checked in
    ///         after the charge was requested (so a guardian that's offline can't be skipped by silence).
    mapping(uint256 vaultId => bool) public holdIfGuardianSilent;
    /// @notice Up to when each guardian key has reviewed charges (set by `guardianCheckIn`).
    mapping(address guardian => uint64) public guardianLastSeen;

    // ------------------------------------------------------------------ events

    event VaultCreated(uint256 indexed vaultId, address indexed parent, address indexed child);
    event Deposited(uint256 indexed vaultId, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed vaultId, address indexed to, uint256 amount);

    event RulesChanged(
        uint256 indexed vaultId,
        uint64 indexed version,
        address by,
        uint128 perPaymentLimit,
        uint128 weeklyLimit,
        uint64 expiresAt
    );
    event PayeeChanged(
        uint256 indexed vaultId, uint64 indexed version, address by, address indexed payee, bool allowed, string label
    );
    event ChildChanged(
        uint256 indexed vaultId, uint64 indexed version, address by, address child, bool active, uint64 epoch
    );
    event GuardianChanged(uint256 indexed vaultId, uint64 indexed version, address by, address guardian);
    event GuardianHoldChanged(uint256 indexed vaultId, uint64 indexed version, address by, bool hold);
    event GuardianCheckedIn(address indexed guardian, uint64 at);
    event SchoolReserveChanged(uint256 indexed vaultId, uint64 indexed version, address by, uint256 amount);
    event VaultRevoked(uint256 indexed vaultId, uint64 indexed version, address by, uint64 childEpoch, uint64 billingEpoch);

    event Paid(
        uint256 indexed vaultId,
        address indexed payee,
        uint256 amount,
        bytes32 memoHash,
        uint256 indexed exceptionId,
        uint256 nonce
    );
    event Refused(
        uint256 indexed vaultId,
        address indexed payee,
        uint256 amount,
        bytes32 memoHash,
        uint256 indexed exceptionId,
        uint256 nonce,
        Reason reason
    );

    event ExceptionRequested(
        uint256 indexed vaultId, uint256 indexed exceptionId, address indexed payee, uint256 amount, bytes32 memoHash
    );
    event ExceptionDecided(uint256 indexed vaultId, uint256 indexed exceptionId, bool allowed, uint64 validUntil, address by);

    event BillingGranted(
        uint256 indexed vaultId, uint256 indexed billingId, uint64 indexed version, BillingTerms terms, string label
    );
    event BillingRevoked(uint256 indexed vaultId, uint256 indexed billingId, uint64 indexed version, address by);

    event ChargeRequested(
        uint256 indexed billingId,
        uint256 indexed chargeId,
        uint256 amount,
        bytes32 memoHash,
        uint64 settleAfter,
        ChargeStatus status
    );
    event ChargeRefused(uint256 indexed billingId, uint256 amount, bytes32 memoHash, Reason reason);
    event ChargeVetoed(uint256 indexed billingId, uint256 indexed chargeId, address by, string reason);
    event ChargeApproved(uint256 indexed billingId, uint256 indexed chargeId, address by);
    event ChargeSettled(uint256 indexed billingId, uint256 indexed chargeId, address indexed payTo, uint256 amount);
    event ChargeFailed(uint256 indexed billingId, uint256 indexed chargeId, Reason reason);

    // ------------------------------------------------------------------ errors

    error UnknownVault(uint256 vaultId);
    error NotParent();
    error NotBiller();
    error NotParentOrGuardian();
    error BadSignature();
    error IntentExpired();
    error NonceAlreadyUsed();
    error ZeroAmount();
    error ZeroAddress();
    error BadRules();
    error BadTerms();
    error BadState();
    error ChildInactive();
    error VetoWindowClosed();
    error VetoWindowOpen();
    error GuardianSilent();
    error NotEnoughBalance();
    error LengthMismatch();

    // ------------------------------------------------------------------ setup

    constructor(IERC20 token_) EIP712("PocketRails", "1") {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    modifier onlyParent(uint256 vaultId) {
        if (_vault(vaultId).parent != msg.sender) revert NotParent();
        _;
    }

    /// @notice Open a vault for `child` with its first rules (version 1) and approved payees.
    function createVault(
        address child,
        Rules calldata rules,
        address[] calldata payees,
        string[] calldata labels
    ) external returns (uint256 vaultId) {
        if (child == address(0)) revert ZeroAddress();
        if (payees.length != labels.length) revert LengthMismatch();
        _checkRules(rules);

        vaultId = ++vaultCount;
        Vault storage v = _vaults[vaultId];
        v.parent = msg.sender;
        v.child = child;
        v.childActive = true;
        v.childEpoch = 1;
        v.billingEpoch = 1;
        v.version = 1;
        v.rules = rules;
        v.week = currentWeek();

        emit VaultCreated(vaultId, msg.sender, child);
        emit ChildChanged(vaultId, 1, msg.sender, child, true, 1);
        emit RulesChanged(vaultId, 1, msg.sender, rules.perPaymentLimit, rules.weeklyLimit, rules.expiresAt);
        for (uint256 i; i < payees.length; ++i) {
            if (payees[i] == address(0)) revert ZeroAddress();
            isApprovedPayee[vaultId][payees[i]] = true;
            emit PayeeChanged(vaultId, 1, msg.sender, payees[i], true, labels[i]);
        }
    }

    // ------------------------------------------------------------------ money in and out

    /// @notice Add funds you approved to this contract. Anyone may top up any vault (e.g. a relative abroad).
    function deposit(uint256 vaultId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _vault(vaultId).balance += amount;
        emit Deposited(vaultId, msg.sender, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Gasless top-up: `from` signs an EIP-3009 `ReceiveWithAuthorization` to this contract with
    ///         nonce `depositNonce(vaultId, salt)`, and anyone submits it. The nonce binds the signature to
    ///         this vault, so a relayer can't credit a different one.
    function depositWithAuthorization(
        uint256 vaultId,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        Sig calldata sig
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _vault(vaultId).balance += amount;
        emit Deposited(vaultId, from, amount);
        IERC3009(address(token)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, depositNonce(vaultId, salt), sig.v, sig.r, sig.s
        );
    }

    function depositNonce(uint256 vaultId, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), vaultId, salt));
    }

    /// @notice The parent can take money out at any time.
    function withdraw(uint256 vaultId, uint256 amount, address to) external nonReentrant onlyParent(vaultId) {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        Vault storage v = _vaults[vaultId];
        if (amount > v.balance) revert NotEnoughBalance();
        v.balance -= amount;
        if (v.schoolReserve > v.balance) v.schoolReserve = v.balance; // the parent can always take money out
        emit Withdrawn(vaultId, to, amount);
        token.safeTransfer(to, amount);
    }

    // ------------------------------------------------------------------ rules (parent only, versioned)

    function setRules(uint256 vaultId, Rules calldata rules) external onlyParent(vaultId) {
        _checkRules(rules);
        Vault storage v = _vaults[vaultId];
        v.rules = rules;
        uint64 version = ++v.version;
        emit RulesChanged(vaultId, version, msg.sender, rules.perPaymentLimit, rules.weeklyLimit, rules.expiresAt);
    }

    function setPayee(uint256 vaultId, address payee, bool allowed, string calldata label)
        external
        onlyParent(vaultId)
    {
        if (payee == address(0)) revert ZeroAddress();
        isApprovedPayee[vaultId][payee] = allowed;
        uint64 version = ++_vaults[vaultId].version;
        emit PayeeChanged(vaultId, version, msg.sender, payee, allowed, label);
    }

    /// @notice Set or rotate the child's key and turn access on. Bumps the child epoch, so intents and
    ///         exceptions from before this call stop working.
    function setChild(uint256 vaultId, address child) external onlyParent(vaultId) {
        if (child == address(0)) revert ZeroAddress();
        Vault storage v = _vaults[vaultId];
        v.child = child;
        v.childActive = true;
        uint64 epoch = ++v.childEpoch;
        uint64 version = ++v.version;
        emit ChildChanged(vaultId, version, msg.sender, child, true, epoch);
    }

    /// @notice Turn the child's access off now. Later payments are refused (and recorded), pending
    ///         exceptions die. School billing keeps running; use `revokeAll` to stop everything.
    function revokeChild(uint256 vaultId) external onlyParent(vaultId) {
        Vault storage v = _vaults[vaultId];
        v.childActive = false;
        uint64 epoch = ++v.childEpoch;
        uint64 version = ++v.version;
        emit ChildChanged(vaultId, version, msg.sender, v.child, false, epoch);
    }

    /// @notice Set aside part of the balance for school charges ("earmark"). Child payments, including
    ///         one-time exceptions, can't use it; school charges can, and settling one uses up the reserve
    ///         first. Can't exceed the current balance. Set 0 to remove it.
    function setSchoolReserve(uint256 vaultId, uint256 amount) external onlyParent(vaultId) {
        Vault storage v = _vaults[vaultId];
        if (amount > v.balance) revert NotEnoughBalance();
        v.schoolReserve = amount;
        uint64 version = ++v.version;
        emit SchoolReserveChanged(vaultId, version, msg.sender, amount);
    }

    /// @notice Set (or clear, with address(0)) the guardian, a key that may only veto school charges.
    function setGuardian(uint256 vaultId, address guardian) external onlyParent(vaultId) {
        Vault storage v = _vaults[vaultId];
        v.guardian = guardian;
        uint64 version = ++v.version;
        emit GuardianChanged(vaultId, version, msg.sender, guardian);
    }

    /// @notice Turn on (or off) "hold school charges while the guardian is offline". While on, a pending
    ///         charge settles only after the guardian has checked in since the charge was requested. The
    ///         parent can still approve or veto a held charge at any time.
    function setGuardianHold(uint256 vaultId, bool hold) external onlyParent(vaultId) {
        holdIfGuardianSilent[vaultId] = hold;
        uint64 version = ++_vaults[vaultId].version;
        emit GuardianHoldChanged(vaultId, version, msg.sender, hold);
    }

    /// @notice A guardian says "I'm online and have reviewed every charge requested before `reviewedUntil`".
    ///         It approves nothing: charges still need their veto window to pass and stay inside their caps.
    ///         Pass the time of the chain state you reviewed, so charges that arrive while this transaction
    ///         is on its way stay held. Capped at now; never moves backwards. One call covers every vault
    ///         that names the caller as guardian.
    function guardianCheckIn(uint64 reviewedUntil) external {
        uint64 at = reviewedUntil > block.timestamp ? uint64(block.timestamp) : reviewedUntil;
        if (at <= guardianLastSeen[msg.sender]) return;
        guardianLastSeen[msg.sender] = at;
        emit GuardianCheckedIn(msg.sender, at);
    }

    /// @notice Emergency stop: child access off, every billing permission and pending charge dead,
    ///         every pending exception dead. Funds stay in the vault for the parent to withdraw.
    function revokeAll(uint256 vaultId) external onlyParent(vaultId) {
        Vault storage v = _vaults[vaultId];
        v.childActive = false;
        uint64 childEpoch = ++v.childEpoch;
        uint64 billingEpoch = ++v.billingEpoch;
        uint64 version = ++v.version;
        emit VaultRevoked(vaultId, version, msg.sender, childEpoch, billingEpoch);
        emit ChildChanged(vaultId, version, msg.sender, v.child, false, childEpoch);
    }

    // ------------------------------------------------------------------ child payments

    /// @notice Submit a child's signed payment. Returns `Reason.None` when paid, otherwise the refusal
    ///         reason (the transaction still succeeds and records the refusal).
    function pay(Payment calldata p, bytes calldata signature) external nonReentrant returns (Reason reason) {
        if (p.amount == 0) revert ZeroAmount();
        Vault storage v = _vault(p.vaultId);
        _useIntent(v, p.vaultId, p.nonce, p.deadline, hashPayment(p), signature);

        reason = _checkPayment(v, p.vaultId, p.payee, p.amount, p.memoHash, p.exceptionId, p.epoch);
        if (reason != Reason.None) {
            emit Refused(p.vaultId, p.payee, p.amount, p.memoHash, p.exceptionId, p.nonce, reason);
            return reason;
        }

        v.balance -= p.amount;
        if (p.exceptionId == 0) {
            _rollWeek(v);
            v.weekSpent += p.amount;
        } else {
            // Exceptions are separate, parent-approved amounts: they don't use the weekly allowance.
            _exceptions[p.exceptionId].status = ExceptionStatus.Used;
        }
        emit Paid(p.vaultId, p.payee, p.amount, p.memoHash, p.exceptionId, p.nonce);
        token.safeTransfer(p.payee, p.amount);
    }

    /// @notice What would happen to this payment right now, without signing anything. Uses the
    ///         current epoch. The app calls this to warn before the child signs.
    function previewPayment(
        uint256 vaultId,
        address payee,
        uint256 amount,
        bytes32 memoHash,
        uint256 exceptionId
    ) external view returns (Reason) {
        Vault storage v = _vault(vaultId);
        return _checkPayment(v, vaultId, payee, amount, memoHash, exceptionId, v.childEpoch);
    }

    // ------------------------------------------------------------------ one-time exceptions

    /// @notice Submit a child's signed request for a payment outside the rules.
    function requestException(ExceptionRequest calldata r, bytes calldata signature)
        external
        returns (uint256 exceptionId)
    {
        if (r.amount == 0) revert ZeroAmount();
        if (r.payee == address(0)) revert ZeroAddress();
        Vault storage v = _vault(r.vaultId);
        _useIntent(v, r.vaultId, r.nonce, r.deadline, hashExceptionRequest(r), signature);
        if (!v.childActive || r.epoch != v.childEpoch) revert ChildInactive();

        exceptionId = ++exceptionCount;
        _exceptions[exceptionId] = Exception({
            vaultId: r.vaultId,
            payee: r.payee,
            amount: r.amount,
            memoHash: r.memoHash,
            epoch: r.epoch,
            validUntil: 0,
            status: ExceptionStatus.Pending
        });
        emit ExceptionRequested(r.vaultId, exceptionId, r.payee, r.amount, r.memoHash);
    }

    /// @notice Allow one exact payment (payee, amount, memo), once, until `validUntil`.
    ///         The standing rules don't change.
    function allowOnce(uint256 exceptionId, uint64 validUntil) external {
        Exception storage e = _exceptions[exceptionId];
        Vault storage v = _vault(e.vaultId);
        if (v.parent != msg.sender) revert NotParent();
        if (e.status != ExceptionStatus.Pending || e.epoch != v.childEpoch) revert BadState();
        if (validUntil <= block.timestamp) revert BadTerms();
        e.status = ExceptionStatus.Approved;
        e.validUntil = validUntil;
        emit ExceptionDecided(e.vaultId, exceptionId, true, validUntil, msg.sender);
    }

    /// @notice Decline a pending request, or cancel an allowed one that hasn't been used.
    function declineException(uint256 exceptionId) external {
        Exception storage e = _exceptions[exceptionId];
        Vault storage v = _vault(e.vaultId);
        if (v.parent != msg.sender) revert NotParent();
        if (e.status != ExceptionStatus.Pending && e.status != ExceptionStatus.Approved) revert BadState();
        e.status = ExceptionStatus.Declined;
        emit ExceptionDecided(e.vaultId, exceptionId, false, 0, msg.sender);
    }

    // ------------------------------------------------------------------ school billing (pull)

    /// @notice Let `terms.biller` request charges from this vault inside the caps. Each charge waits
    ///         `vetoWindow` before it can settle; the parent or guardian can veto it meanwhile.
    function grantBilling(uint256 vaultId, BillingTerms calldata terms, string calldata label)
        external
        onlyParent(vaultId)
        returns (uint256 billingId)
    {
        if (terms.biller == address(0) || terms.payTo == address(0)) revert ZeroAddress();
        if (
            terms.maxPerCharge == 0 || terms.maxPerPeriod < terms.maxPerCharge || terms.period == 0
                || terms.expiresAt <= block.timestamp || terms.vetoWindow < MIN_VETO_WINDOW
                || terms.vetoWindow > MAX_VETO_WINDOW
        ) revert BadTerms();

        Vault storage v = _vaults[vaultId];
        uint64 version = ++v.version;
        billingId = ++billingCount;
        _billings[billingId] = Billing({
            vaultId: vaultId,
            biller: terms.biller,
            payTo: terms.payTo,
            maxPerCharge: terms.maxPerCharge,
            maxPerPeriod: terms.maxPerPeriod,
            period: terms.period,
            startAt: uint64(block.timestamp),
            expiresAt: terms.expiresAt,
            vetoWindow: terms.vetoWindow,
            epoch: v.billingEpoch,
            periodIndex: 0,
            revoked: false,
            firstChargeNeedsApproval: terms.firstChargeNeedsApproval,
            hasSettled: false,
            periodUsed: 0
        });
        emit BillingGranted(vaultId, billingId, version, terms, label);
    }

    /// @notice Revoke a billing permission. Its pending charges can no longer settle.
    function revokeBilling(uint256 billingId) external {
        Billing storage b = _billings[billingId];
        Vault storage v = _vault(b.vaultId);
        if (v.parent != msg.sender) revert NotParent();
        if (b.revoked) revert BadState();
        b.revoked = true;
        uint64 version = ++v.version;
        emit BillingRevoked(b.vaultId, billingId, version, msg.sender);
    }

    /// @notice The biller asks for `amount`. Inside the caps it becomes a pending charge; outside, the
    ///         call succeeds, records `ChargeRefused` and returns the reason.
    function requestCharge(uint256 billingId, uint256 amount, bytes32 memoHash)
        external
        returns (uint256 chargeId, Reason reason)
    {
        Billing storage b = _billings[billingId];
        if (b.biller != msg.sender || msg.sender == address(0)) revert NotBiller();
        if (amount == 0) revert ZeroAmount();
        Vault storage v = _vaults[b.vaultId];

        _rollPeriod(b);
        if (b.revoked || b.epoch != v.billingEpoch) reason = Reason.BillingRevoked;
        else if (block.timestamp >= b.expiresAt) reason = Reason.BillingExpired;
        else if (amount > b.maxPerCharge) reason = Reason.OverChargeLimit;
        else if (b.periodUsed + amount > b.maxPerPeriod) reason = Reason.OverPeriodLimit;

        if (reason != Reason.None) {
            emit ChargeRefused(billingId, amount, memoHash, reason);
            return (0, reason);
        }

        b.periodUsed += amount;
        ChargeStatus status = (b.firstChargeNeedsApproval && !b.hasSettled)
            ? ChargeStatus.AwaitingParent
            : ChargeStatus.Pending;
        uint64 settleAfter = uint64(block.timestamp) + b.vetoWindow;
        chargeId = ++chargeCount;
        _charges[chargeId] = Charge({
            billingId: billingId,
            amount: amount,
            memoHash: memoHash,
            settleAfter: settleAfter,
            periodIndex: b.periodIndex,
            status: status
        });
        emit ChargeRequested(billingId, chargeId, amount, memoHash, settleAfter, status);
    }

    /// @notice Parent or guardian stops a charge. Pending charges can only be vetoed inside their
    ///         window; charges awaiting the parent can be vetoed any time before a decision.
    function vetoCharge(uint256 chargeId, string calldata reason) external {
        Charge storage c = _charges[chargeId];
        Billing storage b = _billings[c.billingId];
        Vault storage v = _vault(b.vaultId);
        if (msg.sender != v.parent && (msg.sender != v.guardian || v.guardian == address(0))) {
            revert NotParentOrGuardian();
        }
        if (c.status == ChargeStatus.Pending) {
            // A charge held for a silent guardian can still be vetoed after its window.
            if (block.timestamp >= c.settleAfter && !_guardianSilent(v, b, c)) revert VetoWindowClosed();
        } else if (c.status != ChargeStatus.AwaitingParent) {
            revert BadState();
        }
        c.status = ChargeStatus.Vetoed;
        _release(b, c);
        emit ChargeVetoed(c.billingId, chargeId, msg.sender, reason);
    }

    /// @notice Parent-only "yes": settle now a charge that is pending, awaiting approval, or was vetoed
    ///         (the override for a wrong veto). The guardian can never call this.
    function approveCharge(uint256 chargeId) external nonReentrant {
        Charge storage c = _charges[chargeId];
        Billing storage b = _billings[c.billingId];
        Vault storage v = _vault(b.vaultId);
        if (msg.sender != v.parent) revert NotParent();
        ChargeStatus s = c.status;
        if (s != ChargeStatus.Pending && s != ChargeStatus.AwaitingParent && s != ChargeStatus.Vetoed) {
            revert BadState();
        }
        if (s == ChargeStatus.Vetoed) {
            // Re-count the amount: an override is the parent's explicit decision, so caps don't block it.
            _rollPeriod(b);
            if (c.periodIndex == b.periodIndex) b.periodUsed += c.amount;
        }
        emit ChargeApproved(c.billingId, chargeId, msg.sender);
        _settle(v, b, c, chargeId);
    }

    /// @notice Anyone can settle a pending charge once its veto window has passed (and, if the parent
    ///         turned on the guardian hold, once the guardian has checked in since the charge was requested).
    function settle(uint256 chargeId) external nonReentrant {
        Charge storage c = _charges[chargeId];
        if (c.status != ChargeStatus.Pending) revert BadState();
        if (block.timestamp < c.settleAfter) revert VetoWindowOpen();
        Billing storage b = _billings[c.billingId];
        Vault storage v = _vaults[b.vaultId];
        if (_guardianSilent(v, b, c)) revert GuardianSilent();
        _settle(v, b, c, chargeId);
    }

    /// @notice True when a pending charge is past its window but waiting for the guardian to check in.
    function isHeld(uint256 chargeId) external view returns (bool) {
        Charge storage c = _charges[chargeId];
        if (c.status != ChargeStatus.Pending || block.timestamp < c.settleAfter) return false;
        Billing storage b = _billings[c.billingId];
        return _guardianSilent(_vaults[b.vaultId], b, c);
    }

    // ------------------------------------------------------------------ views

    function getVault(uint256 vaultId) external view returns (Vault memory) {
        return _vault(vaultId);
    }

    function getException(uint256 exceptionId) external view returns (Exception memory) {
        return _exceptions[exceptionId];
    }

    function getBilling(uint256 billingId) external view returns (Billing memory) {
        return _billings[billingId];
    }

    function getCharge(uint256 chargeId) external view returns (Charge memory) {
        return _charges[chargeId];
    }

    /// @notice Weeks start Monday 00:00 UTC.
    function currentWeek() public view returns (uint64) {
        return uint64((block.timestamp + 3 days) / 1 weeks);
    }

    /// @notice What the child has spent under the standing rules this week.
    function spentThisWeek(uint256 vaultId) public view returns (uint256) {
        Vault storage v = _vault(vaultId);
        return v.week == currentWeek() ? v.weekSpent : 0;
    }

    function hashPayment(Payment calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_TYPEHASH,
                    p.vaultId,
                    p.payee,
                    p.amount,
                    p.memoHash,
                    p.exceptionId,
                    p.nonce,
                    p.epoch,
                    p.deadline
                )
            )
        );
    }

    function hashExceptionRequest(ExceptionRequest calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    EXCEPTION_REQUEST_TYPEHASH, r.vaultId, r.payee, r.amount, r.memoHash, r.nonce, r.epoch, r.deadline
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ internals

    function _vault(uint256 vaultId) private view returns (Vault storage v) {
        v = _vaults[vaultId];
        if (v.parent == address(0)) revert UnknownVault(vaultId);
    }

    function _checkRules(Rules calldata rules) private view {
        if (
            rules.perPaymentLimit == 0 || rules.weeklyLimit < rules.perPaymentLimit
                || rules.expiresAt <= block.timestamp
        ) revert BadRules();
    }

    /// @dev Signature-level checks. These revert: they say nothing about the rules.
    ///      SignatureChecker also accepts ERC-1271, so a child's key can later be a smart account.
    function _useIntent(
        Vault storage v,
        uint256 vaultId,
        uint256 nonce,
        uint64 deadline,
        bytes32 digest,
        bytes calldata signature
    ) private {
        if (block.timestamp > deadline) revert IntentExpired();
        if (nonceUsed[vaultId][nonce]) revert NonceAlreadyUsed();
        if (!SignatureChecker.isValidSignatureNow(v.child, digest, signature)) revert BadSignature();
        nonceUsed[vaultId][nonce] = true;
    }

    function _checkPayment(
        Vault storage v,
        uint256 vaultId,
        address payee,
        uint256 amount,
        bytes32 memoHash,
        uint256 exceptionId,
        uint64 epoch
    ) private view returns (Reason) {
        if (!v.childActive || epoch != v.childEpoch) return Reason.AccessRevoked;
        if (block.timestamp >= v.rules.expiresAt) return Reason.AccessExpired;

        if (exceptionId != 0) {
            Exception storage e = _exceptions[exceptionId];
            if (
                e.vaultId != vaultId || e.status != ExceptionStatus.Approved || e.epoch != v.childEpoch
                    || block.timestamp > e.validUntil
            ) return Reason.ExceptionNotApproved;
            if (e.payee != payee || e.amount != amount || e.memoHash != memoHash) return Reason.ExceptionMismatch;
        } else {
            if (!isApprovedPayee[vaultId][payee]) return Reason.PayeeNotApproved;
            if (amount > v.rules.perPaymentLimit) return Reason.OverPaymentLimit;
            uint256 spent = v.week == currentWeek() ? v.weekSpent : 0;
            if (spent + amount > v.rules.weeklyLimit) return Reason.OverWeeklyLimit;
        }

        if (amount > v.balance) return Reason.InsufficientBalance;
        if (amount > v.balance - v.schoolReserve) return Reason.EarmarkedForSchool;
        return Reason.None;
    }

    /// @dev The hold is on, there's a guardian, and it hasn't checked in since the charge was requested.
    function _guardianSilent(Vault storage v, Billing storage b, Charge storage c) private view returns (bool) {
        if (!holdIfGuardianSilent[b.vaultId] || v.guardian == address(0)) return false;
        return guardianLastSeen[v.guardian] <= c.settleAfter - b.vetoWindow;
    }

    function _rollWeek(Vault storage v) private {
        uint64 week = currentWeek();
        if (v.week != week) {
            v.week = week;
            v.weekSpent = 0;
        }
    }

    function _rollPeriod(Billing storage b) private {
        uint64 idx = uint64((block.timestamp - b.startAt) / b.period);
        if (idx != b.periodIndex) {
            b.periodIndex = idx;
            b.periodUsed = 0;
        }
    }

    /// @dev Give a charge's amount back to its period's allowance, if that period is still current.
    function _release(Billing storage b, Charge storage c) private {
        _rollPeriod(b);
        if (c.periodIndex == b.periodIndex) b.periodUsed -= c.amount;
    }

    function _settle(Vault storage v, Billing storage b, Charge storage c, uint256 chargeId) private {
        Reason reason = Reason.None;
        if (b.revoked || b.epoch != v.billingEpoch) reason = Reason.BillingRevoked;
        else if (c.amount > v.balance) reason = Reason.InsufficientBalance;

        if (reason != Reason.None) {
            c.status = ChargeStatus.Failed;
            _release(b, c);
            emit ChargeFailed(c.billingId, chargeId, reason);
            return;
        }

        c.status = ChargeStatus.Settled;
        b.hasSettled = true;
        v.balance -= c.amount;
        v.schoolReserve = v.schoolReserve > c.amount ? v.schoolReserve - c.amount : 0;
        emit ChargeSettled(c.billingId, chargeId, b.payTo, c.amount);
        token.safeTransfer(b.payTo, c.amount);
    }
}
