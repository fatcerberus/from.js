/*
 *  from.js - LINQ for JavaScript
 *  Copyright (c) 2019, Fat Cerberus
 *  All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without
 *  modification, are permitted provided that the following conditions are met:
 *
 *  * Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 *  * Neither the name of miniSphere nor the names of its contributors may be
 *    used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
**/

type Queryable<T> = T[] | ArrayLike<T> | Iterable<T>;

type Aggregator<T, R> = (accumulator: R, value: T) => R;
type Iteratee<T> = (value: T) => void;
type JoinPredicate<T, U> = (lValue: T, rValue: U) => boolean;
type Predicate<T> = (value: T) => boolean;
type Selector<T, R> = (value: T) => R;
type TypePredicate<T, P extends T> = (value: T) => value is P;
type ZipSelector<T, U, R> = (lValue: T, rValue: U) => R;

interface Chungus<T> extends Iterable<T>
{
	readonly value: T;
}

interface Source<T> extends Iterable<T>
{
	forEach?(iteratee: Predicate<T>): boolean;
}

export = from;
function from<T>(...sources: Queryable<T>[])
{
	return new Query(new ConcatSource(...sources));
}

class Query<T> implements Iterable<T>
{
	readonly [Symbol.toStringTag] = "Query";

	protected source: Source<T>;

	constructor(source: Source<T>)
	{
		this.source = source;
	}

	[Symbol.iterator]()
	{
		return this.source[Symbol.iterator]();
	}

	aggregate<R>(aggregator: Aggregator<T, R>, seedValue: R)
	{
		let accumulator = seedValue;
		iterateOver(this.source, value => {
			accumulator = aggregator(accumulator, value);
			return true;
		});
		return accumulator;
	}

	all(predicate: Predicate<T>)
	{
		let matched = true;
		iterateOver(this.source, value => {
			matched = predicate(value);
			return matched;
		});
		return matched;
	}

	allIn(values: Queryable<T>)
	{
		const valueSet = new Set(sourceOf(values));
		return this.all(it => valueSet.has(it));
	}

	any(predicate: Predicate<T>)
	{
		let foundIt = false;
		iterateOver(this.source, value => {
			if (predicate(value))
				foundIt = true;
			return !foundIt;
		});
		return foundIt;
	}

	anyIn(values: Queryable<T>)
	{
		const valueSet = new Set(sourceOf(values));
		return this.any(it => valueSet.has(it));
	}

	anyIs(value: T)
	{
		const predicate = value !== value
			? (toCheck: T) => toCheck !== toCheck
			: (toCheck: T) => toCheck === value;
		return this.any(predicate);
	}

	apply<V, R>(this: Query<(value: V) => R>, values: Queryable<V>)
	{
		return this.selectMany(fn => from(values).select(fn));
	}

	average(this: Query<number>)
	{
		let count = 0;
		let sum = 0;
		iterateOver(this.source, (value) => {
			++count;
			sum += value;
			return true;
		});
		return sum / count;
	}

	besides(iteratee: Iteratee<T>)
	{
		return this.select(it => (iteratee(it), it));
	}

	concat(...sources: Queryable<T>[])
	{
		return new Query(new ConcatSource(this.source, ...sources));
	}

	count()
	{
		let n = 0;
		iterateOver(this.source, () => (++n, true));
		return n;
	}

	countBy<K>(keySelector: Selector<T, K>)
	{
		const counts = new Map<K, number>();
		iterateOver(this.source, (value) => {
			const key = keySelector(value);
			let count = counts.get(key);
			if (count === undefined)
				count = 0;
			counts.set(key, count++);
			return true;
		});
		return counts;
	}

	distinct<K>(keySelector: Selector<T, K>)
	{
		return new Query(new DistinctSource(this.source, keySelector));
	}

	elementAt(position: number)
	{
		let index = 0;
		let element: T | undefined;
		iterateOver(this.source, value => {
			element = value;
			return index !== position;
		});
		return element;
	}

	except(...blacklists: Queryable<T>[])
	{
		const exclusions = new Set(from(blacklists).selectMany(it => it));
		return new Query(new WithoutSource(this.source, exclusions));
	}

	fatMap<R>(selector: Selector<Chungus<T>, R>, windowSize = 1)
	{
		return new Query(new FatMapSource(this.source, selector, windowSize));
	}

	first(predicate: Predicate<T>)
	{
		let result: T | undefined;
		iterateOver(this.source, value => {
			if (predicate(value)) {
				result = value;
				return false;
			}
			return true;
		});
		return result;
	}

	forEach(iteratee: Iteratee<T>)
	{
		return iterateOver(this.source, it => {
			iteratee(it);
			return true;
		});
	}

	groupBy<K>(keySelector: Selector<T, K>)
	{
		const groups = new Map<K, T[]>();
		iterateOver(this.source, (value) => {
			const key = keySelector(value);
			let list = groups.get(key);
			if (list === undefined)
				groups.set(key, list = []);
			list.push(value);
			return true;
		});
		return groups;
	}

	groupJoin<U, R>(joinSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, Iterable<U>, R>)
	{
		return this.select(lValue => {
			const rValues = from(joinSource)
				.where(it => predicate(lValue, it));
			return selector(lValue, rValues);
		});
	}

	intercalate(this: Query<Queryable<T>>, values: Queryable<T>)
	{
		return this.intersperse(values).selectMany(it => it);
	}

	intersperse(value: T)
	{
		return new Query(new IntersperseSource(this.source, value));
	}

	invoke<V extends unknown[], R>(this: Query<(...args: V) => R>, ...args: V)
	{
		return this.select(fn => fn(...args));
	}

	join<U, R>(joinSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, U, R>)
	{
		return this.selectMany(lValue =>
			from(joinSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it)));
	}

	last(predicate: Predicate<T>)
	{
		let result: T | undefined;
		iterateOver(this.source, (value) => {
			if (predicate(value))
				result = value;
			return true;
		});
		return result;
	}

	orderBy<K>(keySelector: Selector<T, K>, direction: 'asc' | 'desc' = 'asc')
	{
		return new SortQuery(new OrderBySource(this.source, keySelector, direction === 'desc'));
	}

	plus(...values: T[])
	{
		return new Query(new ConcatSource(this.source, values));
	}

	random(count: number)
	{
		return this.thru((values) => {
			let samples = [];
			for (let i = 0, len = values.length; i < count; ++i) {
				const index = Math.floor(Math.random() * len);
				samples.push(values[index]);
			}
			return samples;
		});
	}

	reverse()
	{
		return this.thru(values => values.reverse());
	}

	sample(count: number)
	{
		return this.thru((values) => {
			const nSamples = Math.min(Math.max(count, 0), values.length);
			for (let i = 0, len = values.length; i < nSamples; ++i) {
				const pick = i + Math.floor(Math.random() * (len - i));
				const value = values[pick];
				values[pick] = values[i];
				values[i] = value;
			}
			values.length = nSamples;
			return values;
		});
	}

	select<R>(selector: Selector<T, R>)
	{
		return new Query(new SelectSource(this.source, selector));
	}

	selectMany<R>(selector: Selector<T, Queryable<R>>)
	{
		return new Query(new SelectManySource(this.source, selector));
	}

	shuffle()
	{
		return this.thru((values) => {
			for (let i = 0, len = values.length - 1; i < len; ++i) {
				const pick = i + Math.floor(Math.random() * (len - i));
				const value = values[pick];
				values[pick] = values[i];
				values[i] = value;
			}
			return values;
		});
	}

	skip(count: number)
	{
		return new Query(new SkipSource(this.source, count));
	}

	skipLast(count: number)
	{
		return new Query(new SkipLastSource(this.source, count));
	}

	skipWhile(predicate: Predicate<T>)
	{
		return new Query(new SkipWhileSource(this.source, predicate));
	}

	sum(this: Query<number>)
	{
		return this.aggregate((acc, value) => acc + value, 0);
	}

	take(count: number)
	{
		return new Query(new TakeSource(this.source, count));
	}

	takeLast(count: number)
	{
		// takeLast can't be lazily evaluated because we don't know where to
		// start until we've seen the final element.
		return this.thru((values) => {
			return count > 0 ? values.slice(-count) : [];
		});
	}

	takeWhile(predicate: Predicate<T>)
	{
		return new Query(new TakeWhileSource(this.source, predicate));
	}

	thru<R>(transformer: Selector<T[], Queryable<R>>)
	{
		return new Query(new ThruSource(this.source, transformer));
	}

	toArray()
	{
		return arrayOf(this.source);
	}

	where(predicate: Predicate<T>): Query<T>
	where<P extends T>(predicate: TypePredicate<T, P>): Query<P>
	where(predicate: Predicate<T>)
	{
		return new Query(new WhereSource(this.source, predicate));
	}

	without(...values: T[])
	{
		return new Query(new WithoutSource(this.source, new Set(values)));
	}

	zip<U, R>(zipSource: Queryable<U>, selector: ZipSelector<T, U, R>)
	{
		return new Query(new ZipSource(this.source, sourceOf(zipSource), selector));
	}
}

class SortQuery<T, K> extends Query<T>
{
	constructor(source: OrderBySource<T, K>)
	{
		super(source);
	}

	thenBy<K>(keySelector: Selector<T, K>, direction: 'asc' | 'desc' = 'asc')
	{
		return new SortQuery(new OrderBySource(this.source, keySelector, direction === 'desc', true));
	}
}

class ArrayLikeSource<T> implements Source<T>
{
	private array: ArrayLike<T>;

	constructor(array: ArrayLike<T>)
	{
		this.array = array;
	}

	*[Symbol.iterator]()
	{
		for (let i = 0, len = this.array.length; i < len; ++i)
			yield this.array[i];
	}

	forEach(iteratee: Predicate<T>)
	{
		for (let i = 0, len = this.array.length; i < len; ++i) {
			if (!iteratee(this.array[i]))
				return false;
		}
		return true;
	}
}

class ChungusSource<T> implements Source<T>, Chungus<T>
{
	private armSize: number;
	private buffer: T[];
	private leftArm = -1;
	private readPtr = -1;
	private rightArm = 0;
	private stride: number;
	private writePtr = 0;

	constructor(windowSize: number)
	{
		// it's called a chungus because, being a circular buffer, it's round...
		// just like Big Chungus!  *MUNCH*
		this.stride = windowSize * 2 + 1;  // this is how fat he can be
		this.buffer = new Array<T>(this.stride);
		this.armSize = windowSize;
	}

	*[Symbol.iterator]()
	{
		// it's time to circumnavigate the chungus...
		let ptr = ((this.readPtr + this.stride) - this.leftArm) % this.stride;
		const len = 1 + this.leftArm + this.rightArm;
		for (let i = 0; i < len; ++i, ptr = (ptr + 1) % this.stride)
			yield this.buffer[ptr];
	}

	get value(): T
	{
		return this.buffer[this.readPtr];
	}

	forEach(iteratee: Predicate<T>)
	{
		let ptr = ((this.readPtr + this.stride) - this.leftArm) % this.stride;
		const len = 1 + this.leftArm + this.rightArm;
		for (let i = 0; i < len; ++i, ptr = (ptr + 1) % this.stride) {
			if (!iteratee(this.buffer[ptr]))
				return false;
		}
		return true;
	}

	advance()
	{
		if (++this.readPtr >= this.stride)
			this.readPtr = 0;
		if (++this.leftArm > this.armSize)
			this.leftArm = this.armSize;
		return this.rightArm-- > 0;
	}

	feed(value: T)
	{
		this.buffer[this.writePtr] = value;
		if (++this.writePtr >= this.stride)
			this.writePtr = 0;
		if (++this.rightArm > this.armSize)
			this.advance();  // *munch*
	}
}

class ConcatSource<T> implements Source<T>
{
	private sources: Source<T>[] = [];

	constructor(...sources: Queryable<T>[])
	{
		for (let i = 0, len = sources.length; i < len; ++i)
			this.sources.push(sourceOf(sources[i]));
	}

	*[Symbol.iterator]()
	{
		for (let i = 0, len = this.sources.length; i < len; ++i)
			yield* this.sources[i];
	}

	forEach(iteratee: Predicate<T>)
	{
		for (let i = 0, len = this.sources.length; i < len; ++i) {
			if (!iterateOver(this.sources[i], iteratee))
				return false;
		}
		return true;
	}
}

class DistinctSource<T, K> implements Source<T>
{
	private keySelector: Selector<T, K>
	private source: Source<T>;

	constructor(source: Source<T>, keySelector: Selector<T, K>)
	{
		this.source = source;
		this.keySelector = keySelector;
	}

	*[Symbol.iterator]()
	{
		const foundKeys = new Set<K>();
		for (const value of this.source) {
			const key = this.keySelector(value);
			if (!foundKeys.has(key)) {
				foundKeys.add(key);
				yield value;
			}
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		const foundKeys = new Set<K>();
		return iterateOver(this.source, value => {
			const key = this.keySelector(value);
			if (!foundKeys.has(key)) {
				foundKeys.add(key);
				if (!iteratee(value))
					return false;
			}
			return true;
		});
	}
}

class FatMapSource<T, R> implements Source<R>
{
	private selector: Selector<Chungus<T>, R>;
	private source: Source<T>;
	private windowSize: number;

	constructor(source: Source<T>, selector: Selector<Chungus<T>, R>, windowSize: number)
	{
		this.source = source;
		this.selector = selector;
		this.windowSize = windowSize;
	}

	*[Symbol.iterator]()
	{
		// your small business is going to be squeezed out by Big Chungus.
		const chungus = new ChungusSource<T>(this.windowSize)
		let lag = this.windowSize + 1;
		for (const value of this.source) {
			chungus.feed(value);
			if (--lag <= 0)
				yield this.selector(chungus);
		}
		while (chungus.advance())
			yield this.selector(chungus);
	}

	forEach(iteratee: Predicate<R>)
	{
		const chungus = new ChungusSource<T>(this.windowSize)
		let lag = this.windowSize + 1;
		const keepGoing = iterateOver(this.source, (value) => {
			chungus.feed(value);
			if (--lag <= 0)
				return iteratee(this.selector(chungus));
			return true;
		});
		if (!keepGoing)
			return false;
		while (chungus.advance()) {
			if (!iteratee(this.selector(chungus)))
				return false;
		}
		return true;
	}
}

class IntersperseSource<T> implements Source<T>
{
	private source: Source<T>;
	private value: T;

	constructor(source: Source<T>, value: T)
	{
		this.source = source;
		this.value = value;
	}

	*[Symbol.iterator]()
	{
		let firstElement = true;
		for (const value of this.source) {
			if (!firstElement)
				yield this.value;
			yield value;
			firstElement = false;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		let firstElement = true;
		return iterateOver(this.source, (value) => {
			if (!firstElement) {
				if (!iteratee(this.value))
					return false;
			}
			if (!iteratee(value))
				return false;
			firstElement = false;
			return true;
		});
	}
}

class OrderBySource<T, K> implements Source<T>
{
	private keyMakers: { keySelector: Selector<T, K>, descending: boolean }[];
	private source: Source<T>;

	constructor(source: Source<T>, keySelector: Selector<T, K>, descending: boolean, auxiliary = false)
	{
		const keyMaker = { keySelector, descending };
		if (auxiliary && source instanceof OrderBySource) {
			this.source = source.source;
			this.keyMakers = [ ...source.keyMakers, keyMaker ];
		}
		else {
			this.source = source;
			this.keyMakers = [ keyMaker ];
		}
	}

	*[Symbol.iterator]()
	{
		const results = this.computeResults();
		for (let i = 0, len = results.length; i < len; ++i)
			yield results[i].value;
	}

	forEach(iteratee: Predicate<T>)
	{
		const results = this.computeResults();
		for (let i = 0, len = results.length; i < len; ++i) {
			if (!iteratee(results[i].value))
				return false;
		}
		return true;
	}

	private computeResults()
	{
		const keyLists: K[][] = [];
		const results: { index: number, value: T }[] = [];
		let index = 0;
		iterateOver(this.source, (value) => {
			const keyList = new Array<K>(this.keyMakers.length);
			for (let i = 0, len = this.keyMakers.length; i < len; ++i)
				keyList[i] = this.keyMakers[i].keySelector(value);
			keyLists.push(keyList);
			results.push({ index: index++, value });
			return true;
		});
		return results.sort((a, b) => {
			const aKeys = keyLists[a.index];
			const bKeys = keyLists[b.index];
			for (let i = 0, len = this.keyMakers.length; i < len; ++i) {
				const invert = this.keyMakers[i].descending;
				if (aKeys[i] < bKeys[i])
					return invert ? +1 : -1;
				else if (aKeys[i] > bKeys[i])
					return invert ? -1 : +1;
			}
			return a.index - b.index;
		});
	}
}

class SelectSource<T, R> implements Source<R>
{
	private selector: Selector<T, R>;
	private source: Source<T>;

	constructor(source: Source<T>, selector: Selector<T, R>)
	{
		this.source = source;
		this.selector = selector;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.source)
			yield this.selector(value);
	}

	forEach(iteratee: Predicate<R>)
	{
		return iterateOver(this.source, it => iteratee(this.selector(it)));
	}
}

class SelectManySource<T, U> implements Source<U>
{
	private selector: Selector<T, Queryable<U>>;
	private source: Source<T>;

	constructor(source: Source<T>, selector: Selector<T, Queryable<U>>)
	{
		this.source = source;
		this.selector = selector;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.source)
			yield* sourceOf(this.selector(value));
	}

	forEach(iteratee: Predicate<U>)
	{
		return iterateOver(this.source, (value) => {
			const results = sourceOf(this.selector(value));
			return iterateOver(results, iteratee);
		});
	}
}

class SkipSource<T> implements Source<T>
{
	private count: number;
	private source: Source<T>;

	constructor(source: Source<T>, count: number)
	{
		this.source = source;
		this.count = count;
	}

	*[Symbol.iterator]()
	{
		let skipsLeft = this.count;
		for (const value of this.source) {
			if (skipsLeft-- <= 0)
				yield value;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		let skipsLeft = this.count;
		return iterateOver(this.source, value => {
			return skipsLeft-- <= 0 ? iteratee(value)
				: true;
		});
	}
}

class SkipLastSource<T> implements Source<T>
{
	private count: number;
	private source: Source<T>;

	constructor(source: Source<T>, count: number)
	{
		this.source = source;
		this.count = count;
	}

	*[Symbol.iterator]()
	{
		const buffer = new Array<T>(this.count);
		let ptr = 0;
		let skipsLeft = this.count;
		for (const value of this.source) {
			if (skipsLeft-- <= 0)
				yield buffer[ptr];
			buffer[ptr] = value;
			ptr = (ptr + 1) % this.count;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		const buffer = new Array<T>(this.count);
		let ptr = 0;
		let skipsLeft = this.count;
		return iterateOver(this.source, (value) => {
			if (skipsLeft-- <= 0) {
				if (!iteratee(buffer[ptr]))
					return false;
			}
			buffer[ptr] = value;
			ptr = (ptr + 1) % this.count;
			return true;
		});
	}
}

class SkipWhileSource<T> implements Source<T>
{
	private predicate: Predicate<T>;
	private source: Source<T>;

	constructor(source: Source<T>, predicate: Predicate<T>)
	{
		this.source = source;
		this.predicate = predicate;
	}

	*[Symbol.iterator]()
	{
		let onTheTake = false;
		for (const value of this.source) {
			if (!onTheTake && this.predicate(value))
				onTheTake = true;
			if (onTheTake)
				yield value;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		let onTheTake = false;
		return iterateOver(this.source, value => {
			if (!onTheTake && !this.predicate(value))
				onTheTake = true;
			return onTheTake ? iteratee(value)
				: false;
		});
	}
}

class TakeSource<T> implements Source<T>
{
	private count: number;
	private source: Source<T>;

	constructor(source: Source<T>, count: number)
	{
		this.source = source;
		this.count = count;
	}

	*[Symbol.iterator]()
	{
		let takesLeft = this.count;
		for (const value of this.source) {
			if (takesLeft-- <= 0)
				break;
			yield value;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		let takesLeft = this.count;
		return iterateOver(this.source, value => {
			return takesLeft-- > 0 ? iteratee(value)
				: false
		});
	}
}

class TakeWhileSource<T> implements Source<T>
{
	private predicate: Predicate<T>;
	private source: Source<T>;

	constructor(source: Source<T>, predicate: Predicate<T>)
	{
		this.source = source;
		this.predicate = predicate;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.source) {
			if (!this.predicate(value))
				break;
			yield value;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		return iterateOver(this.source, value => {
			if (!this.predicate(value))
				return false;
			return iteratee(value);
		});
	}
}

class ThruSource<T, R> implements Source<R>
{
	private source: Source<T>;
	private transformer: Selector<T[], Queryable<R>>;

	constructor(source: Source<T>, transformer: Selector<T[], Queryable<R>>)
	{
		this.source = source;
		this.transformer = transformer;
	}

	[Symbol.iterator]()
	{
		const oldValues: T[] = arrayOf(this.source);
		const newValues = this.transformer(oldValues);
		return sourceOf(newValues)[Symbol.iterator]();
	}

	forEach(iteratee: Predicate<R>)
	{
		const oldValues: T[] = arrayOf(this.source);
		const newValues = this.transformer(oldValues);
		return iterateOver(sourceOf(newValues), value => {
			return iteratee(value);
		});
	}
}

class WhereSource<T> implements Source<T>
{
	private predicate: Predicate<T>;
	private source: Source<T>;

	constructor(source: Source<T>, predicate: Predicate<T>)
	{
		this.source = source;
		this.predicate = predicate;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.source) {
			if (this.predicate(value))
				yield value;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		return iterateOver(this.source, value => {
			return this.predicate(value) ? iteratee(value)
				: true;
		});
	}
}

class WithoutSource<T> implements Source<T>
{
	private source: Source<T>;
	private values: Set<T>

	constructor(source: Source<T>, values: Set<T>)
	{
		this.source = source;
		this.values = values;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.source) {
			if (!this.values.has(value))
				yield value;
		}
	}

	forEach(iteratee: Predicate<T>)
	{
		return iterateOver(this.source, value => {
			return !this.values.has(value) ? iteratee(value)
				: true;
		});
	}
}

class ZipSource<T, U, R> implements Source<R>
{
	private leftSource: Source<T>;
	private rightSource: Source<U>;
	private selector: ZipSelector<T, U, R>;

	constructor(leftSource: Source<T>, rightSource: Source<U>, selector: ZipSelector<T, U, R>)
	{
		this.leftSource = leftSource;
		this.rightSource = rightSource;
		this.selector = selector;
	}

	*[Symbol.iterator]()
	{
		const iter = this.rightSource[Symbol.iterator]();
		let result: IteratorResult<U>;
		for (const value of this.leftSource) {
			if ((result = iter.next()).done)
				break;
			yield this.selector(value, result.value);
		}
	}

	forEach(iteratee: Predicate<R>)
	{
		const iter = this.rightSource[Symbol.iterator]();
		let result: IteratorResult<U>;
		return iterateOver(this.leftSource, value => {
			if ((result = iter.next()).done)
				return false;
			return iteratee(this.selector(value, result.value));
		});
	}
}

function arrayOf<T>(source: Source<T>)
{
	const values: T[] = [];
	iterateOver(source, (value) => {
		values.push(value);
		return true;
	});
	return values;
}

function iterateOver<T>(source: Source<T>, iteratee: Predicate<T>)
{
	if (source.forEach !== undefined) {
		// prefer forEach if it exists (better performance!)
		return source.forEach(iteratee);
	}
	else {
		// no forEach, fall back on [Symbol.iterator]
		for (const value of source) {
			if (!iteratee(value))
				return false;
		}
		return true;
	}
}

function sourceOf<T>(queryable: Queryable<T>)
{
	return 'length' in queryable
		? new ArrayLikeSource(queryable)
		: queryable;
}
