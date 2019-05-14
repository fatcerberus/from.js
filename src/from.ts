/*
 *  from.js - LINQ-to-Objects for JavaScript
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

type Queryable<T> = T[] | ArrayLike<T> | Query<T>;

type Aggregator<T, R> = (accumulator: R, value: T) => R;
type Iteratee<T> = (value: T) => void;
type JoinPredicate<T, U> = (lValue: T, rValue: U) => boolean;
type Predicate<T> = (value: T) => boolean;
type Selector<T, R> = (value: T) => R;
type ZipSelector<T, U, R> = (lValue: T, rValue: U) => R;

interface Enumerator<T>
{
	readonly current: T;
	moveNext(): boolean;
}

interface Sequence<T>
{
	enumerate(): Enumerator<T>;
	forEach?(iteratee: Predicate<T>): boolean;
}

export default
function from<T>(source: Queryable<T>)
{
	return new Query(sequenceOf(source));
}

class Query<T> implements Iterable<T>
{
	readonly [Symbol.toStringTag] = "Query";

	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>)
	{
		this.sequence = sequence;
	}

	*[Symbol.iterator]()
	{
		const iter = this.sequence.enumerate();
		while (iter.moveNext())
			yield iter.current;
	}

	aggregate<R>(aggregator: Aggregator<T, R>, seedValue: R)
	{
		let accumulator = seedValue;
		forEach(this.sequence, it => {
			accumulator = aggregator(accumulator, it);
			return true;
		});
		return accumulator;
	}

	join<U, R>(innerSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, U, R>)
	{
		return this.selectMany(lValue =>
			from(innerSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it)));
	}

	select<R>(selector: Selector<T, R>)
	{
		return new Query(new SelectSeq(this.sequence, selector));
	}

	selectMany<R>(selector: Selector<T, Queryable<R>>)
	{
		return new Query(new SelectManySeq(this.sequence, selector));
	}

	take(count: number) {
		return new Query(new TakeSeq(this.sequence, count));
	}

	toArray()
	{
		return this.aggregate((a, it) => (a.push(it), a), [] as T[])
	}

	where(predicate: Predicate<T>)
	{
		return new Query(new WhereSeq(this.sequence, predicate));
	}

	zip<U, R>(zipSource: Queryable<U>, selector: ZipSelector<T, U, R>)
	{
		return new Query(new ZipSeq(this.sequence, sequenceOf(zipSource), selector));
	}
}

class ArrayLikeSeq<T> implements Sequence<T>
{
	private array: ArrayLike<T>;

	constructor(array: ArrayLike<T>) {
		this.array = array;
	}
	enumerate() {
		const source = this.array;
		const length = source.length;
		let index = -1;
		return {
			get current() {
				return source[index];
			},
			moveNext() {
				return ++index < length;
			},
		};
	}
	forEach(iteratee: Predicate<T>) {
		for (let i = 0, len = this.array.length; i < len; ++i) {
			if (!iteratee(this.array[i]))
				return false;
		}
		return true;
	}
}

class SelectSeq<T, U> implements Sequence<U>
{
	private selector: Selector<T, U>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, selector: Selector<T, U>) {
		this.sequence = sequence;
		this.selector = selector;
	}
	enumerate() {
		const iter = this.sequence.enumerate();
		const selector = this.selector;
		let value: U;
		return {
			get current() {
				return value;
			},
			moveNext() {
				if (!iter.moveNext())
					return false;
				value = selector(iter.current);
				return true;
			},
		};
	}
	forEach(iteratee: Predicate<U>) {
		return forEach(this.sequence, it => iteratee(this.selector(it)));
	}
}

class SelectManySeq<T, U> implements Sequence<U>
{
	private selector: Selector<T, Queryable<U>>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, selector: Selector<T, Queryable<U>>) {
		this.sequence = sequence;
		this.selector = selector;
	}
	enumerate() {
		const iter = this.sequence.enumerate();
		const selector = this.selector;
		let innerIter: Enumerator<U> | undefined;
		let value: U;
		return {
			get current() {
				return value;
			},
			moveNext() {
				if (innerIter === undefined) {
					if (!iter.moveNext())
						return false;
					const seq = sequenceOf(selector(iter.current));
					innerIter = seq.enumerate();
				}
				if (!innerIter.moveNext())
					return false;
				value = innerIter.current;
				return true;
			},
		};
	}
	forEach(iteratee: Predicate<U>) {
		return forEach(this.sequence, it => {
			const picks = sequenceOf(this.selector(it));
			return forEach(picks, iteratee);
		});
	}
}

class TakeSeq<T> implements Sequence<T>
{
	private count: number;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, count: number) {
		this.sequence = sequence;
		this.count = count;
	}
	enumerate() {
		const iter = this.sequence.enumerate();
		let left = this.count;
		let value: T;
		return {
			get current() {
				return value;
			},
			moveNext() {
				if (left-- == 0 || !iter.moveNext())
					return false;
				value = iter.current;
				return true;
			},
		};
	}
	forEach(iteratee: Predicate<T>) {
		let left = this.count;
		return forEach(this.sequence, (value: T) =>
			left-- > 0 ? iteratee(value) : false);
	}
}

class WhereSeq<T> implements Sequence<T>
{
	private predicate: Predicate<T>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, predicate: Predicate<T>) {
		this.sequence = sequence;
		this.predicate = predicate;
	}
	enumerate() {
		const iter = this.sequence.enumerate();
		const predicate = this.predicate;
		let value: T;
		return {
			get current() {
				return value;
			},
			moveNext() {
				while (iter.moveNext()) {
					value = iter.current;
					if (predicate(value))
						return true;
				}
				return false;
			},
		};
	}
	forEach(iteratee: Predicate<T>) {
		return forEach(this.sequence, it => {
			return this.predicate(it)
				? iteratee(it)
				: true;
		});
	}
}

class ZipSeq<T, U, R> implements Sequence<R>
{
	private selector: ZipSelector<T, U, R>;
	private leftSeq: Sequence<T>;
	private rightSeq: Sequence<U>;

	constructor(leftSeq: Sequence<T>, rightSeq: Sequence<U>, selector: ZipSelector<T, U, R>) {
		this.leftSeq = leftSeq;
		this.rightSeq = rightSeq;
		this.selector = selector;
	}
	enumerate() {
		const lIter = this.leftSeq.enumerate();
		const rIter = this.rightSeq.enumerate();
		const selector = this.selector;
		let value: R;
		return {
			get current() {
				return value;
			},
			moveNext() {
				if (!lIter.moveNext() || !rIter.moveNext())
					return false;
				value = selector(lIter.current, rIter.current);
				return true;
			},
		};
	}
	forEach(iteratee: Predicate<R>) {
		const rIter = this.rightSeq.enumerate();
		return forEach(this.leftSeq, (value: T) => {
			if (!rIter.moveNext())
				return false;
			return iteratee(this.selector(value, rIter.current));
		});
	}
}

function forEach<T>(sequence: Sequence<T>, iteratee: Predicate<T>)
{
	if (sequence.forEach !== undefined) {
		return sequence.forEach(iteratee);
	}
	else {
		const iter = sequence.enumerate();
		while (iter.moveNext()) {
			if (!iteratee(iter.current))
				return false;
		}
		return true;
	}
}

function sequenceOf<T>(source: Queryable<T>)
{
	return source instanceof Query
		? source.sequence
		: new ArrayLikeSeq(source);
}
