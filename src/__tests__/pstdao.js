export function handle(state, action) {
  const balances = state.balances;
  const vault = state.vault;
  const votes = state.votes;
  const input = action.input;
  const caller = action.caller;
  const voteLength = state.voteLength;
  const quorum = state.quorum;
  const support = state.support;
  if (input.function === "transfer") {
    const target = input.target;
    const qty = input.qty;
    if (!Number.isInteger(qty)) {
      throw new ContractError('Invalid value for "qty". Must be an integer.');
    }
    if (!target) {
      throw new ContractError("No target specified.");
    }
    if (qty <= 0 || caller === target) {
      throw new ContractError("Invalid token transfer.");
    }
    if (!(caller in balances)) {
      throw new ContractError("Caller doesn't own any DAO balance.");
    }
    if (balances[caller] < qty) {
      throw new ContractError(`Caller balance not high enough to send ${qty} token(s)!`);
    }
    balances[caller] -= qty;
    if (target in balances) {
      balances[target] += qty;
    } else {
      balances[target] = qty;
    }
    return {state};
  }
  if (input.function === "balance") {
    const target = input.target || caller;
    if (typeof target !== "string") {
      throw new ContractError("Must specificy target to get balance for.");
    }
    let balance = 0;
    if (target in balances) {
      balance = balances[target];
    }
    if (target in vault) {
      balance += vault[target].map((a) => a.balance).reduce((a, b) => a + b, 0);
    }
    return {result: {target, balance}};
  }
  if (input.function === "unlockedBalance") {
    const target = input.target || caller;
    if (typeof target !== "string") {
      throw new ContractError("Must specificy target to get balance for.");
    }
    if (!(target in balances)) {
      throw new ContractError("Cannnot get balance, target does not exist.");
    }
    let balance = balances[target];
    return {result: {target, balance}};
  }
  if (input.function === "lock") {
    const qty = input.qty;
    const lockLength = input.lockLength;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ContractError("Quantity must be a positive integer.");
    }
    if (!Number.isInteger(lockLength) || lockLength < state.lockMinLength || lockLength > state.lockMaxLength) {
      throw new ContractError(`lockLength is out of range. lockLength must be between ${state.lockMinLength} - ${state.lockMaxLength}.`);
    }
    const balance = balances[caller];
    if (isNaN(balance) || balance < qty) {
      throw new ContractError("Not enough balance.");
    }
    balances[caller] -= qty;
    const start = SmartWeave.block.height;
    const end = start + lockLength;
    if (caller in vault) {
      vault[caller].push({
        balance: qty,
        end,
        start
      });
    } else {
      vault[caller] = [{
        balance: qty,
        end,
        start
      }];
    }
    return {state};
  }
  if (input.function === "increaseVault") {
    const lockLength = input.lockLength;
    const id = input.id;
    if (!Number.isInteger(lockLength) || lockLength < state.lockMinLength || lockLength > state.lockMaxLength) {
      throw new ContractError(`lockLength is out of range. lockLength must be between ${state.lockMinLength} - ${state.lockMaxLength}.`);
    }
    if (caller in vault) {
      if (!vault[caller][id]) {
        throw new ContractError("Invalid vault ID.");
      }
    } else {
      throw new ContractError("Caller does not have a vault.");
    }
    vault[caller][id].end = SmartWeave.block.height + lockLength;
    return {state};
  }
  if (input.function === "unlock") {
    if (caller in vault) {
      let i = vault[caller].length;
      while (i--) {
        const locked = vault[caller][i];
        if (SmartWeave.block.height >= locked.end) {
          balances[caller] += locked.balance;
          vault[caller].splice(i, 1);
        }
      }
    }
    return {state};
  }
  if (input.function === "vaultBalance") {
    const target = input.target || caller;
    let balance = 0;
    if (target in vault) {
      const blockHeight = SmartWeave.block.height;
      const filtered = vault[target].filter((a) => {
        return blockHeight < a.start + a.end;
      });
      for (let i = 0, j = filtered.length; i < j; i++) {
        balance += filtered[i].balance;
      }
    }
    return {result: {target, balance}};
  }
  if (input.function === "propose") {
    const voteType = input.type;
    const note = input.note;
    if (typeof note !== "string") {
      throw new ContractError("Note format not recognized.");
    }
    if (!(caller in vault)) {
      throw new ContractError("caller need to have locked balances.");
    }
    const hasBalance = vault[caller] && !!vault[caller].filter((a) => a.balance > 0).length;
    if (!hasBalance) {
      throw new ContractError("Caller doesn't have any locked balance.");
    }
    let totalWeight = 0;
    const vaultValues = Object.values(vault);
    for (let i = 0, j = vaultValues.length; i < j; i++) {
      const locked = vaultValues[i];
      for (let j2 = 0, k = locked.length; j2 < k; j2++) {
        totalWeight += locked[j2].balance * (locked[j2].end - locked[j2].start);
      }
    }
    let vote = {
      status: "active",
      type: voteType,
      note,
      yays: 0,
      nays: 0,
      voted: [],
      start: SmartWeave.block.height,
      totalWeight
    };
    if (voteType === "mint" || voteType === "mintLocked") {
      const recipient = input.recipient;
      const qty = input.qty;
      if (!recipient) {
        throw new ContractError("No recipient specified");
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new ContractError('Invalid value for "qty". Must be a positive integer.');
      }
      let lockLength = {};
      if (input.lockLength) {
        if (!Number.isInteger(input.lockLength) || input.lockLength < state.lockMinLength || input.lockLength > state.lockMaxLength) {
          throw new ContractError(`lockLength is out of range. lockLength must be between ${state.lockMinLength} - ${state.lockMaxLength}.`);
        }
        lockLength = {lockLength: input.lockLength};
      }
      Object.assign(vote, {
        recipient,
        qty
      }, lockLength);
      votes.push(vote);
    } else if (voteType === "burnVault") {
      const target = input.target;
      const id = input.id;
      if (!target || typeof target !== "string") {
        throw new ContractError("Target is required.");
      }
      if (isNaN(id) || !Number.isInteger(id) || id < 0 || !(target in vault) || !vault[target][id]) {
        throw new ContractError("Invalid vault ID.");
      }
      Object.assign(vote, {
        target,
        id
      });
    } else if (voteType === "set") {
      if (typeof input.key !== "string") {
        throw new ContractError("Data type of key not supported.");
      }
      if (input.key === "quorum") {
        if (isNaN(input.value) || input.value < 0.01 || input.value > 0.99) {
          throw new ContractError("Quorum must be between 0.01 and 0.99.");
        }
      } else if (input.key === "support") {
        if (isNaN(input.value) || input.value < 0.01 || input.value > 0.99) {
          throw new ContractError("Support must be between 0.01 and 0.99.");
        }
      } else if (input.key === "lockMinLength") {
        if (!Number.isInteger(input.value) || input.value < 1 || input.value >= state.lockMaxLength) {
          throw new ContractError("lockMinLength cannot be less than 1 and cannot be equal or greater than lockMaxLength.");
        }
      } else if (input.key === "lockMaxLength") {
        if (!Number.isInteger(input.value) || input.value <= state.lockMinLength) {
          throw new ContractError("lockMaxLength cannot be less than or equal to lockMinLength.");
        }
      } else if (input.key === "ticker" || input.key === "balances" || input.key === "vault" || input.key === "votes" || input.key === "roles" || input.key === "voteLength") {
        throw new ContractError("This DAO option cannot be changed.");
      }
      Object.assign(vote, {
        key: input.key,
        value: input.value
      });
      votes.push(vote);
    } else if (voteType === "indicative") {
      votes.push(vote);
    } else {
      throw new ContractError("Invalid vote type.");
    }
    return {state};
  }
  if (input.function === "vote") {
    const id = input.id;
    const cast = input.cast;
    if (!Number.isInteger(id)) {
      throw new ContractError('Invalid value for "id". Must be an integer.');
    }
    const vote = votes[id];
    let voterBalance = 0;
    if (caller in vault) {
      for (let i = 0, j = vault[caller].length; i < j; i++) {
        const locked = vault[caller][i];
        if (locked.start < vote.start && locked.end >= vote.start) {
          voterBalance += locked.balance * (locked.end - locked.start);
        }
      }
    }
    if (voterBalance <= 0) {
      throw new ContractError("Caller does not have locked balances for this vote.");
    }
    if (vote.voted.includes(caller)) {
      throw new ContractError("Caller has already voted.");
    }
    if (SmartWeave.block.height >= vote.start + voteLength) {
      throw new ContractError("Vote has already concluded.");
    }
    if (cast === "yay") {
      vote.yays += voterBalance;
    } else if (cast === "nay") {
      vote.nays += voterBalance;
    } else {
      throw new ContractError("Vote cast type unrecognised.");
    }
    vote.voted.push(caller);
    return {state};
  }
  if (input.function === "finalize") {
    const id = input.id;
    const vote = votes[id];
    const qty = vote.qty;
    if (!vote) {
      throw new ContractError("This vote doesn't exists.");
    }
    if (SmartWeave.block.height < vote.start + voteLength) {
      throw new ContractError("Vote has not yet concluded.");
    }
    if (vote.status !== "active") {
      throw new ContractError("Vote is not active.");
    }
    if (vote.totalWeight * quorum > vote.yays + vote.nays) {
      vote.status = "quorumFailed";
      return {state};
    }
    if (vote.yays !== 0 && (vote.nays === 0 || vote.yays / vote.nays > support)) {
      vote.status = "passed";
      if (vote.type === "mint") {
        if (vote.recipient in balances) {
          balances[vote.recipient] += qty;
        } else {
          balances[vote.recipient] = qty;
        }
      } else if (vote.type === "mintLocked") {
        const start = SmartWeave.block.height;
        const end = start + vote.lockLength;
        const locked = {
          balance: qty,
          start,
          end
        };
        if (vote.recipient in vault) {
          vault[vote.recipient].push(locked);
        } else {
          vault[vote.recipient] = [locked];
        }
      } else if (vote.type === "burnVault") {
        if (vote.target in vault && vault[vote.target][vote.id]) {
          state.vault[vote.target].splice(vote.id, 1);
        } else {
          vote.status = "failed";
        }
      } else if (vote.type === "set") {
        if (vote.key === "role") {
          state.roles[vote.value.target] = vote.value.role;
        } else {
          state[vote.key] = vote.value;
        }
      }
    } else {
      vote.status = "failed";
    }
    return {state};
  }
  if (input.function === "role") {
    const target = input.target || caller;
    const role = target in state.roles ? state.roles[target] : "";
    if (!role.trim().length) {
      throw new Error("Target doesn't have a role specified.");
    }
    return {result: {target, role}};
  }
  throw new ContractError(`No function supplied or function not recognised: "${input.function}"`);
}
